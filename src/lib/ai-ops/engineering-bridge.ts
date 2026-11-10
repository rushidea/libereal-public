import { randomUUID } from 'node:crypto';
import type { BackgroundTask } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { revalidateAiOpsActor } from './business';
import { persistentBudgetLedger, sha256 } from './model-client';
import { loadAiOpsPolicy, type AiOpsPolicy } from './policy';
import { parseAiOpsPayload } from './tasks';
import { ENGINEERING_STAGES, parseBridgeRequest, safeEngineeringLinks, safeErrorCode, type BridgeRequest, type BridgeResult, type BridgeScope } from './bridge-protocol';
import type { AiOpsActor, AiOpsStage } from './contracts';

const JOB_TYPE = 'aiops.control.engineering';
const RUNNER_TYPE = 'aiops.control.runner';
export const ENGINEERING_LEASE_MS = 45_000;
const jobId = (taskId: string) => `aiops-engineering-${sha256(taskId)}`;
const runnerId = (id: string) => `aiops-runner-${sha256(id)}`;
type JobState = { version: 1; taskId: string; parentLock: string; scope?: BridgeScope; runnerId?: string };
type JobProgress = { stage: AiOpsStage; links?: { pr?: string; ci?: string; staging?: string }; terminalStage?: BridgeResult['terminalStage']; safeErrorCode?: string };
export function bridgeScope(policy: AiOpsPolicy): BridgeScope {
  const e = policy.engineering;
  if (!e) throw new Error('engineering_not_configured');
  return { model: policy.model, budgetScope: policy.budgetScope, maxBudgetNanousd: policy.maxBudgetNanousd,
    engineering: { repository: e.repository, baseRef: e.baseRef, baseBranch: e.baseBranch, allowedPaths: e.allowedPaths } };
}
async function authorizedParent(row: BackgroundTask) {
  const state = JSON.parse(row.payload) as JobState;
  const task = await prisma.backgroundTask.findFirst({ where: { id: state.taskId, type: 'aiops.run', status: 'running', lockedBy: state.parentLock } });
  if (!task || !task.lockedAt || task.lockedAt.getTime() < Date.now() - ENGINEERING_LEASE_MS) throw new Error('aiops_bridge_lease_lost');
  const payload = parseAiOpsPayload(task.payload);
  const actor = await revalidateAiOpsActor(payload.actor);
  if (!actor.permissions.includes('tasks.manage')) throw new Error('aiops_actor_forbidden');
  return { state, task, payload };
}
async function heartbeat(id: string) {
  await prisma.backgroundTask.updateMany({ where: { id: runnerId(id), type: RUNNER_TYPE, status: 'succeeded' }, data: { lockedAt: new Date() } });
}
export async function engineeringAvailability(): Promise<{ available: boolean; reason: string | null; stagingAvailable: boolean }> {
  const policy = await loadAiOpsPolicy().catch(() => null);
  if (!policy?.engineering) return { available: false, reason: 'engineering_not_configured', stagingAvailable: false };
  const runner = await prisma.backgroundTask.findFirst({ where: { type: RUNNER_TYPE, status: 'succeeded', lockedAt: { gte: new Date(Date.now() - 60_000) } }, orderBy: { lockedAt: 'desc' } });
  if (!runner) return { available: false, reason: 'runner_offline', stagingAvailable: false };
  try {
    const p = JSON.parse(runner.payload) as { capabilities: { engineering: boolean; staging: boolean } };
    return { available: p.capabilities.engineering === true, reason: p.capabilities.engineering ? null : 'engineering_host_unavailable', stagingAvailable: p.capabilities.engineering === true && p.capabilities.staging === true && Boolean(policy.engineering.staging) };
  } catch { return { available: false, reason: 'runner_offline', stagingAvailable: false }; }
}

// The only entrypoint is the existing SSH service account. No public HTTP endpoint,
// bearer token, independent queue or second budget store is created.
export async function handleEngineeringBridge(value: unknown) {
  const policy = await loadAiOpsPolicy();
  if (!policy?.engineering) throw new Error('engineering_not_configured');
  const input = parseBridgeRequest(value, policy.engineering.staging?.url);
  try { return await dispatchEngineeringBridge(input, policy); }
  catch (error) {
    if (input.op !== 'claim') {
      const row = await prisma.backgroundTask.findFirst({ where: { id: jobId(input.taskId), type: JOB_TYPE, status: 'running', lockedBy: input.leaseId } });
      if (row) {
        const previous = JSON.parse(row.result || '{}') as JobProgress;
        await prisma.backgroundTask.updateMany({ where: { id: row.id, status: 'running', lockedBy: input.leaseId }, data: { status: 'failed', completedAt: new Date(), result: JSON.stringify({ ...previous, terminalStage: 'needs_reconciliation', safeErrorCode: safeErrorCode(error) }) } });
      }
    }
    throw error;
  }
}
async function dispatchEngineeringBridge(input: BridgeRequest, policy: AiOpsPolicy) {
  if (!policy.engineering) throw new Error('engineering_not_configured');
  if (input.op === 'claim') {
    await prisma.backgroundTask.upsert({ where: { id: runnerId(input.runnerId) },
      create: { id: runnerId(input.runnerId), type: RUNNER_TYPE, status: 'succeeded', maxAttempts: 1, payload: JSON.stringify({ version: 1, runnerId: input.runnerId, capabilities: input.capabilities }), lockedAt: new Date(), completedAt: new Date() },
      update: { payload: JSON.stringify({ version: 1, runnerId: input.runnerId, capabilities: input.capabilities }), lockedAt: new Date() },
    });
    if (!input.capabilities.engineering) return { ok: true as const, job: null };
    const row = await prisma.backgroundTask.findFirst({ where: { type: JOB_TYPE, status: 'pending', attempts: 0 }, orderBy: { createdAt: 'asc' } });
    if (!row) return { ok: true as const, job: null };
    const { state, payload } = await authorizedParent(row);
    const leaseId = randomUUID();
    const changed = await prisma.backgroundTask.updateMany({ where: { id: row.id, type: JOB_TYPE, status: 'pending', attempts: 0, payload: row.payload }, data: { status: 'running', attempts: 1, lockedBy: leaseId, lockedAt: new Date(), payload: JSON.stringify({ ...state, scope: bridgeScope(policy), runnerId: input.runnerId }) } });
    if (changed.count !== 1) throw new Error('aiops_bridge_lease_lost');
    return { ok: true as const, job: { taskId: state.taskId, request: payload.request, leaseId, scope: bridgeScope(policy) } };
  }
  const row = await prisma.backgroundTask.findFirst({ where: { id: jobId(input.taskId), type: JOB_TYPE, status: 'running', lockedBy: input.leaseId, lockedAt: { gte: new Date(Date.now() - ENGINEERING_LEASE_MS) } } });
  if (!row) throw new Error('aiops_bridge_lease_lost');
  const { state } = await authorizedParent(row);
  if (JSON.stringify(state.scope) !== JSON.stringify(bridgeScope(policy))) throw new Error('engineering_scope_invalid');
  if (state.runnerId !== input.runnerId || state.taskId !== input.taskId) throw new Error('aiops_bridge_lease_lost');
  const previous = JSON.parse(row.result || '{"stage":"proposal"}') as JobProgress;
  await heartbeat(input.runnerId);
  if (input.op === 'checkpoint') {
    const held = await prisma.backgroundTask.updateMany({ where: { id: row.id, status: 'running', lockedBy: input.leaseId, lockedAt: row.lockedAt }, data: { lockedAt: new Date() } });
    if (held.count !== 1) throw new Error('aiops_bridge_lease_lost');
    if (input.action === 'budget_reserve') {
      if (previous.stage !== input.call.stage) throw new Error('aiops_bridge_invalid');
      await persistentBudgetLedger.reserve(policy, { ...input.call, taskId: input.taskId, leaseId: input.leaseId, startedAt: new Date().toISOString() });
    } else if (input.action === 'budget_settle') {
      const call = await prisma.backgroundTask.findUnique({ where: { id: input.callId } });
      if (!call || call.type !== 'aiops.control.call') throw new Error('aiops_budget_call_missing');
      const callState = JSON.parse(call.payload) as { taskId?: string; leaseId?: string; inputHash?: string };
      if (callState.taskId !== input.taskId || callState.leaseId !== input.leaseId || callState.inputHash !== input.result.inputHash) throw new Error('aiops_budget_call_invalid');
      await persistentBudgetLedger.settle(policy, input.callId, input.result);
    } else if (input.action === 'progress' && input.progress) {
      const next = ENGINEERING_STAGES.indexOf(input.progress.stage);
      const current = ENGINEERING_STAGES.indexOf(previous.stage);
      if (next < current || next > current + 1) throw new Error('aiops_bridge_invalid');
      const links = input.progress.links ? safeEngineeringLinks(input.progress.links, policy.engineering.staging?.url) : {};
      if (previous.links?.pr && links.pr && links.pr !== previous.links.pr) throw new Error('aiops_bridge_invalid');
      const updated = await prisma.backgroundTask.updateMany({ where: { id: row.id, status: 'running', lockedBy: input.leaseId }, data: { result: JSON.stringify({ stage: input.progress.stage, links: { ...previous.links, ...links } }) } });
      if (updated.count !== 1) throw new Error('aiops_bridge_lease_lost');
    }
    return { ok: true as const };
  }
  const links = { ...previous.links, ...safeEngineeringLinks(input.result.links ?? {}, policy.engineering.staging?.url) };
  if (previous.links?.pr && links.pr !== previous.links.pr) throw new Error('aiops_bridge_invalid');
  if (input.result.terminalStage === 'awaiting_production_approval' && (previous.stage !== 'staging' || !links.pr || !links.ci || !links.staging || !input.result.artifacts?.treeSha256 || input.result.artifacts.privateCommit !== policy.engineering.staging?.privateCommit)) throw new Error('aiops_bridge_invalid');
  const done = await prisma.backgroundTask.updateMany({ where: { id: row.id, status: 'running', lockedBy: input.leaseId }, data: { status: 'succeeded', completedAt: new Date(), result: JSON.stringify({ ...input.result, stage: previous.stage, links }), lockedAt: null, lockedBy: null } });
  if (done.count !== 1) throw new Error('aiops_bridge_lease_lost');
  return { ok: true as const };
}

type WaitInput = { taskId: string; request: string; actor: AiOpsActor; signal: AbortSignal; assertActive: () => Promise<void>; onProgress: (p: { stage: AiOpsStage; links?: JobProgress['links'] }) => Promise<void> };
export async function waitForEngineeringTask(input: WaitInput) {
  await input.assertActive();
  const actor = await revalidateAiOpsActor(input.actor);
  if (!actor.permissions.includes('tasks.manage')) throw new Error('aiops_actor_forbidden');
  if (!(await engineeringAvailability()).available) return { terminalStage: 'needs_connection' as const, safeErrorCode: 'runner_offline' };
  const parent = await prisma.backgroundTask.findFirst({ where: { id: input.taskId, type: 'aiops.run', status: 'running' } });
  if (!parent?.lockedBy) throw new Error('aiops_bridge_lease_lost');
  await prisma.backgroundTask.create({ data: { id: jobId(input.taskId), type: JOB_TYPE, payload: JSON.stringify({ version: 1, taskId: input.taskId, parentLock: parent.lockedBy }), result: JSON.stringify({ stage: 'proposal' }), maxAttempts: 1 } });
  const waitingSince = Date.now();
  let lastProgress = '';
  try {
    while (true) {
      await input.assertActive();
      const freshActor = await revalidateAiOpsActor(input.actor);
      if (!freshActor.permissions.includes('tasks.manage')) throw new Error('aiops_actor_forbidden');
      const row = await prisma.backgroundTask.findUnique({ where: { id: jobId(input.taskId) } });
      if (!row) throw new Error('aiops_bridge_lease_lost');
      const progress = JSON.parse(row.result || '{}') as JobProgress;
      if (row.result !== lastProgress && ENGINEERING_STAGES.includes(progress.stage)) { await input.onProgress({ stage: progress.stage, links: progress.links }); lastProgress = row.result || ''; }
      if (row.status === 'succeeded') return { terminalStage: progress.terminalStage ?? 'needs_reconciliation' as const, links: progress.links, safeErrorCode: progress.safeErrorCode };
      if (row.status !== 'pending' && row.status !== 'running') return { terminalStage: 'needs_reconciliation' as const, links: progress.links, safeErrorCode: progress.safeErrorCode ?? 'execution_unknown' };
      if (row.status === 'running' && (!row.lockedAt || row.lockedAt.getTime() < Date.now() - ENGINEERING_LEASE_MS) || row.status === 'pending' && Date.now() - waitingSince > 60_000) {
        await prisma.backgroundTask.updateMany({ where: { id: row.id, status: row.status, lockedBy: row.lockedBy, lockedAt: row.lockedAt }, data: { status: 'failed', completedAt: new Date(), result: JSON.stringify({ ...progress, terminalStage: 'needs_reconciliation', safeErrorCode: 'runner_offline' }) } });
        return { terminalStage: 'needs_reconciliation' as const, links: progress.links, safeErrorCode: 'runner_offline' };
      }
      await new Promise<void>((resolve, reject) => {
        const stop = () => { clearTimeout(timer); reject(new Error('aiops_bridge_lease_lost')); };
        const timer = setTimeout(() => { input.signal.removeEventListener('abort', stop); resolve(); }, 1000);
        input.signal.addEventListener('abort', stop, { once: true });
        if (input.signal.aborted) stop();
      });
    }
  } catch (error) {
    // A running lease is never requeued, including cancellation and worker shutdown.
    await prisma.backgroundTask.updateMany({ where: { id: jobId(input.taskId), status: { in: ['pending', 'running'] } }, data: { status: 'failed', completedAt: new Date() } }).catch(() => undefined);
    throw error;
  }
}
