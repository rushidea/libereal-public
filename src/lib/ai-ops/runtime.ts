import type { BackgroundTask } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AI_OPS_TYPE, type AiOpsActor, type AiOpsKind, type AiOpsStage, type AiOpsSummary } from './contracts';
import { parseAiOpsPayload, updateAiOpsProgress } from './tasks';
import { loadAiOpsPolicy } from './policy';
import { safeErrorCode, SAFE_ERROR_CODES } from './bridge-protocol';

type Progress = { stage: AiOpsStage; message?: string; links?: { pr?: string; ci?: string; staging?: string } };
function verifiedLinks(links: Progress['links']) {
  if (!links) return {};
  const valid = (link: unknown, pattern: RegExp) => typeof link === 'string' && pattern.test(link) ? link : undefined;
  return { pr: valid(links.pr, /^https:\/\/github\.com\/rushidea\/libereal-public\/pull\/[0-9]+$/), ci: valid(links.ci, /^https:\/\/github\.com\/rushidea\/libereal-public\/actions\/runs\/[0-9]+$/) };
}
type ExecutionResult = { safeErrorCode?: string; terminalStage?: 'needs_connection' | 'needs_reconciliation' | 'awaiting_production_approval'; output?: string; links?: AiOpsSummary['links']; usage?: AiOpsSummary['usage'] };
export type ResolvedAiOpsActor = AiOpsActor & { permissions: readonly string[] };
type Context = { assertActive: () => Promise<void>; taskId: string; request: string; actor: ResolvedAiOpsActor; signal: AbortSignal; onProgress: (progress: Progress) => Promise<void> };
export type AiOpsRuntimeAdapters = {
  revalidateActor: (actor: AiOpsActor) => Promise<ResolvedAiOpsActor>;
  route: (context: { assertActive: () => Promise<void>; taskId: string; request: string; kind: AiOpsKind; workerId?: string; actor: ResolvedAiOpsActor; signal: AbortSignal }) => Promise<{ kind: 'business'; workerId: string } | { kind: 'engineering' }>;
  business: (context: Context & { workerId: string }) => Promise<ExecutionResult>;
  engineering?: (context: Context) => Promise<ExecutionResult>;
};

export function createAiOpsRuntime(adapters: AiOpsRuntimeAdapters) {
  return async function run(task: BackgroundTask, options: { workerId: string; signal?: AbortSignal }): Promise<void> {
    if (task.type !== AI_OPS_TYPE || task.status !== 'running' || task.lockedBy !== options.workerId) throw new Error('AI task is not owned by this worker');
    const controller = new AbortController();
    const externalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', externalAbort, { once: true });
    if (options.signal?.aborted) controller.abort();
    let summary: AiOpsSummary = { version: 1, kind: 'auto', stage: 'supervisor', status: 'running', updatedAt: new Date().toISOString() };
    let polling = false;
    const timer = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const held = await prisma.backgroundTask.updateMany({ where: { id: task.id, type: AI_OPS_TYPE, status: 'running', lockedBy: options.workerId }, data: { lockedAt: new Date() } });
        if (held.count !== 1) controller.abort();
      } catch { controller.abort(); } finally { polling = false; }
    }, 1000);
    async function assertOwned() {
      if (controller.signal.aborted) throw new Error('AI task stopped');
      const held = await prisma.backgroundTask.findFirst({ where: { id: task.id, type: AI_OPS_TYPE, status: 'running', lockedBy: options.workerId }, select: { id: true } });
      if (!held || controller.signal.aborted) { controller.abort(); throw new Error('AI task ownership lost'); }
    }
    async function save(stage: AiOpsStage, terminal?: 'succeeded' | 'failed') {
      if (controller.signal.aborted) throw new Error('AI task stopped');
      const role: Record<string, string> = { supervisor: 'supervisor', proposal: 'engineering_supervisor', architecture: 'engineering_architect', coding: 'engineering_coder', review: 'engineering_reviewer', pull_request: 'engineering_publisher', ci: 'engineering_ci', staging: 'engineering_staging' };
      if (role[stage]) summary.workerId = role[stage];
      summary = { ...summary, stage, status: terminal ?? 'running', updatedAt: new Date().toISOString() };
      if (!await updateAiOpsProgress(task.id, options.workerId, summary, terminal)) { controller.abort(); throw new Error('AI task ownership lost'); }
    }
    try {
      const payload = parseAiOpsPayload(task.payload);
      summary.kind = payload.kind;
      await save('supervisor');
      const actor = await adapters.revalidateActor(payload.actor);
      if (controller.signal.aborted) throw new Error('AI task stopped');
      await assertOwned();
      const decision = await adapters.route({ assertActive: assertOwned, taskId: task.id, request: payload.request, kind: payload.kind, workerId: payload.workerId, actor, signal: controller.signal });
      if (controller.signal.aborted) throw new Error('AI task stopped');
      if (decision.kind !== 'business' && decision.kind !== 'engineering') throw new Error('Invalid route');
      summary.kind = decision.kind;
      if (decision.kind === 'business') {
        if (!/^[a-z0-9_-]{1,64}$/i.test(decision.workerId)) throw new Error('Invalid business worker');
        summary.workerId = decision.workerId;
      }
      const allowed: AiOpsStage[] = decision.kind === 'business' ? ['business'] : ['proposal', 'architecture', 'coding', 'review', 'pull_request', 'ci', 'staging', 'awaiting_production_approval'];
      const onProgress = async (progress: Progress) => {
        if (!allowed.includes(progress.stage)) throw new Error('Invalid AI task stage');
        // Only the host engineering adapter may publish verified GitHub links.
        if (decision.kind === 'engineering' && progress.links) {
          const links = verifiedLinks(progress.links);
          const configuredUrl = progress.stage === 'staging' ? (await loadAiOpsPolicy())?.engineering?.staging?.url : undefined;
          const staging = configuredUrl && progress.links.staging === configuredUrl ? configuredUrl : undefined;
          summary.links = { ...summary.links, ...(links.pr ? { pr: links.pr } : {}), ...(links.ci ? { ci: links.ci } : {}), ...(staging ? { staging } : {}) };
        }
        await save(progress.stage);
      };
      if (decision.kind === 'engineering' && !adapters.engineering) { await save('needs_connection', 'failed'); return; }
      await save(decision.kind === 'business' ? 'business' : 'proposal');
      const context = { assertActive: assertOwned, taskId: task.id, request: payload.request, actor, signal: controller.signal, onProgress };
      await assertOwned();
      const result = decision.kind === 'business' ? await adapters.business({ ...context, workerId: decision.workerId }) : await adapters.engineering!(context);
      if (controller.signal.aborted) throw new Error('AI task stopped');
      if (result.safeErrorCode && (SAFE_ERROR_CODES as readonly string[]).includes(result.safeErrorCode)) summary.failureCode = result.safeErrorCode;
      if (typeof result.output === 'string') summary.output = result.output;
      if (result.usage) summary.usage = result.usage;
      if (decision.kind === 'engineering' && result.links) {
        const links = verifiedLinks(result.links);
        summary.links = { ...summary.links, ...(links.pr ? { pr: links.pr } : {}), ...(links.ci ? { ci: links.ci } : {}) };
      }
      if (decision.kind === 'engineering' && result.terminalStage === 'needs_connection') await save('needs_connection', 'failed');
      else if (decision.kind === 'engineering' && result.terminalStage === 'awaiting_production_approval') await save('awaiting_production_approval', 'succeeded');
      else if (decision.kind === 'engineering') await save('needs_reconciliation', 'failed');
      else await save('complete', 'succeeded');
    } catch (error) {
      summary.failureCode = safeErrorCode(error);
      // Failure details may contain prompts, credentials, or private rows. Never save them.
      const stage = controller.signal.aborted || summary.kind === 'engineering' ? 'needs_reconciliation' : 'failed';
      await updateAiOpsProgress(task.id, options.workerId, { ...summary, stage, status: 'failed', updatedAt: new Date().toISOString() }, 'failed').catch(() => undefined);
    } finally {
      clearInterval(timer);
      options.signal?.removeEventListener('abort', externalAbort);
    }
  };
}
