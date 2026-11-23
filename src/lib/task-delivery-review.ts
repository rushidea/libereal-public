import type { BackgroundTask, Prisma } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit';
import { letterHash } from '@/lib/business-letter-render';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { jsonObject } from '@/lib/order-catalog-repricing';

type Db = Prisma.TransactionClient;
type Actor = { id: string; email: string };
const types = new Set(['email.send', 'sms.send', 'order.reminder']);
const outcomes = new Set(['all_accepted', 'none_accepted', 'partial', 'unknown']);

type TaskKind = 'email' | 'sms' | 'credit_reminder' | 'business_letter';
type Address = { channel:'email'|'sms'; recipient:string };
export type DeliveryScope = { kind:TaskKind; reference:string|null; sourceVersion:string|null; targets:(Address & { id:string })[] };

export function isDeliveryTask(task: Pick<BackgroundTask, 'type'>) {
  return types.has(task.type);
}

export function deliveryReviewable(task: Pick<BackgroundTask, 'type' | 'status'>) {
  return isDeliveryTask(task) && ['awaiting_human', 'failed'].includes(task.status);
}

function textValue(value: unknown) {
  return typeof value==='string' && value.trim() && value.length<=500 ? value : null;
}

function addresses(channel: Address['channel'], value: unknown): Address[] {
  const entries=Array.isArray(value)?value:[value];
  const recipients=entries.map(textValue);
  return recipients.every((recipient):recipient is string=>recipient!==null)
    ? recipients.map(recipient=>({channel,recipient})) : [];
}

function scope(kind:TaskKind, reference:string|null, sourceVersion:string|null, targets:Address[]): DeliveryScope {
  const unique=new Map(targets.map(target=>{
    const id=pricingContentHash(target);
    return [id,{...target,id}];
  }));
  return {kind,reference,sourceVersion,targets:[...unique.values()].sort((a,b)=>a.id.localeCompare(b.id))};
}

export function deliveryDomainPermission(task: Pick<BackgroundTask,'type'|'payload'>) {
  if (task.type==='order.reminder') return 'finance.read';
  if (task.type==='email.send' && jsonObject(task.payload).kind==='business_letter') return 'inquiries.read';
  return null;
}

export async function storeReminderDeliveryScope(db: Db, task: BackgroundTask, emails: string[], phone?: string|null) {
  if (!task.lockedBy) return false;
  const payload=jsonObject(task.payload);
  const deliveryScope=scope('credit_reminder',textValue(payload.receivableId),textValue(payload.reminderAt),
    [...addresses('email',emails),...(phone?addresses('sms',phone):[])]);
  const updated=await db.backgroundTask.updateMany({
    where:{id:task.id,type:'order.reminder',status:'running',lockedBy:task.lockedBy,attempts:task.attempts,payload:task.payload},
    data:{result:JSON.stringify({attempt:task.attempts,deliveryScope})},
  });
  return updated.count===1;
}

export async function taskDeliveryScope(db: Db, task: BackgroundTask): Promise<DeliveryScope> {
  const payload=jsonObject(task.payload);
  if (task.type==='sms.send') return scope('sms',null,null,addresses('sms',payload.phone));
  if (task.type==='order.reminder') {
    const result=jsonObject(task.result);
    const stored=result.deliveryScope as Partial<DeliveryScope> | undefined;
    const reference=textValue(payload.receivableId);
    const version=textValue(payload.reminderAt);
    const targets=result.attempt===task.attempts && stored?.kind==='credit_reminder' && stored.reference===reference
      && stored.sourceVersion===version && Array.isArray(stored.targets)
      ? stored.targets.flatMap(target=>target && (target.channel==='email' || target.channel==='sms')
        ? addresses(target.channel,target.recipient) : []) : [];
    return scope('credit_reminder',reference,version,targets);
  }
  if (payload.kind==='business_letter') {
    const reference=textValue(payload.draftId);
    const draft=reference ? await db.businessLetterDraft.findUnique({where:{id:reference},select:{approvedAt:true,approvalHash:true,snapshot:true}}) : null;
    const snapshot=jsonObject(draft?.snapshot);
    const version=draft?.approvedAt && letterHash(snapshot)===draft.approvalHash ? draft.approvalHash : null;
    const message=version? snapshot.message as {to?:unknown}|undefined : undefined;
    return scope('business_letter',reference,version,addresses('email',message?.to));
  }
  return scope('email',null,null,addresses('email',payload.to));
}

export function deliveryVersion(task: BackgroundTask, deliveryScope: DeliveryScope) {
  return pricingContentHash({ id: task.id, type: task.type, status: task.status, payload: task.payload, attempts: task.attempts,
    dedupeKey: task.dedupeKey, result: task.result, lastError: task.lastError, updatedAt: task.updatedAt.toISOString(), deliveryScope });
}

function reviewTargets(input: unknown) {
  if (input===undefined) return [];
  if (!Array.isArray(input) || input.length>200 || input.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))
    || new Set(input).size!==input.length) return null;
  return [...input].sort() as string[];
}

export async function recordDeliveryReview(tx: Db, taskId: string, input: Record<string, unknown>, actor: Actor,
  permission: ReturnType<typeof deliveryDomainPermission>) {
  const task = await tx.backgroundTask.findUnique({ where: { id: taskId } });
  const { version, outcome, reference, sha256 } = input;
  if (!task || !isDeliveryTask(task) || deliveryDomainPermission(task)!==permission
      || typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version) || typeof outcome !== 'string' || !outcomes.has(outcome)
      || typeof reference !== 'string' || !reference.trim() || reference.length > 500
      || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) return null;
  const selected=reviewTargets(input.targetIds);
  if (!selected) return null;
  const intent = { actorId: actor.id, taskId, version, outcome, reference: reference.trim(), sha256 };
  const reviewId = pricingContentHash(input.targetIds===undefined ? intent : {...intent,targetIds:selected});
  const prior = jsonObject(task.result);
  const history=await tx.auditLog.findMany({where:{actorId:actor.id,targetType:'BackgroundTask',targetId:taskId,resource:'tasks',
    action:'task.delivery_reviewed',afterData:{contains:reviewId}},select:{afterData:true}});
  const previous=history.map(row=>jsonObject(row.afterData)).find(row=>row.reviewId===reviewId);
  if (previous?.status==='awaiting_human' || previous?.status==='delivery_reviewed') return {status:previous.status,reviewId};
  if (prior.reviewId===reviewId && (task.status==='awaiting_human'||task.status==='delivery_reviewed')) return {status:task.status,reviewId};
  if (!deliveryReviewable(task)) return null;
  const deliveryScope=await taskDeliveryScope(tx,task);
  if (version!==deliveryVersion(task,deliveryScope)) return null;
  const originalTargets=new Set(deliveryScope.targets.map(target=>target.id));
  const complete=outcome==='all_accepted'||outcome==='none_accepted';
  const targetIds=complete && input.targetIds===undefined?[...originalTargets]:selected;
  if (targetIds.some(id=>!originalTargets.has(id)) || complete && (!originalTargets.size || targetIds.length!==originalTargets.size)
    || outcome==='partial' && !targetIds.length) return null;
  const review={...intent,targetIds,scopeVersion:pricingContentHash(deliveryScope)};
  const status = complete ? 'delivery_reviewed' : 'awaiting_human';
  const changed = await tx.backgroundTask.updateMany({
    where: { id: taskId, type: task.type, status: task.status, updatedAt: task.updatedAt, result: task.result,
      attempts:task.attempts,payload:task.payload,lastError:task.lastError },
    data: { status, result: JSON.stringify({ ...prior, ...(task.type==='order.reminder'?{attempt:task.attempts,deliveryScope}:{}), reviewId, ...review }),
      completedAt: status === 'delivery_reviewed' ? new Date() : null },
  });
  if (!changed.count) return null;
  await writeAuditLog({ actorId: actor.id, actorEmail: actor.email, action: 'task.delivery_reviewed',
    resource: 'tasks', targetType: 'BackgroundTask', targetId: task.id,
    before: { status: task.status, result: task.result, lastError: task.lastError }, after: { status, reviewId, ...review } }, tx);
  return { status, reviewId };
}
