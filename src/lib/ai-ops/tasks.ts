import type { BackgroundTask } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { SAFE_ERROR_CODES } from './bridge-protocol';
import { AI_OPS_STAGES, AI_OPS_TYPE, type AiOpsPayload, type AiOpsSummary, type AiOpsKind } from './contracts';

export function parseAiOpsPayload(value: string): AiOpsPayload {
  const p: unknown = JSON.parse(value);
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Invalid AI task payload');
  const x = p as Record<string, unknown>;
  const actor = x.actor as Record<string, unknown> | null;
  if (x.version !== 1 || typeof x.request !== 'string' || !x.request.trim() ||
      (x.kind !== 'auto' && x.kind !== 'business' && x.kind !== 'engineering') || typeof x.createdAt !== 'string' ||
      !actor || typeof actor.id !== 'string' || !actor.id || typeof actor.sessionId !== 'string' || !actor.sessionId ||
      (x.workerId !== undefined && typeof x.workerId !== 'string')) throw new Error('Invalid AI task payload');
  return { version: 1, request: x.request, kind: x.kind, actor: { id: actor.id, sessionId: actor.sessionId }, createdAt: x.createdAt, ...(typeof x.workerId === 'string' ? { workerId: x.workerId } : {}) };
}

export function parseAiOpsSummary(value: string | null): AiOpsSummary | null {
  if (!value) return null;
  try {
    const x: unknown = JSON.parse(value);
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
    const s = x as AiOpsSummary;
    if (s.version !== 1 || (s.kind !== 'auto' && s.kind !== 'business' && s.kind !== 'engineering') || !AI_OPS_STAGES.includes(s.stage) || typeof s.status !== 'string' || typeof s.updatedAt !== 'string') return null;
    return s;
  } catch { return null; }
}

// This projection deliberately excludes payload, output, errors, lock owner and dedupe key.
export function projectAiOpsTask(task: BackgroundTask) {
  const summary = parseAiOpsSummary(task.result);
  return {
    id: task.id, type: task.type, status: task.status, attempts: task.attempts,
    createdAt: task.createdAt, updatedAt: task.updatedAt, completedAt: task.completedAt,
    summary: summary ? {
      version: 1 as const, kind: summary.kind, stage: summary.stage,
      status: task.status, updatedAt: summary.updatedAt, cancelled: summary.cancelled === true,
      failureCode: summary.failureCode && (SAFE_ERROR_CODES as readonly string[]).includes(summary.failureCode) ? summary.failureCode : undefined,
      workerId: summary.workerId && /^[a-z0-9_-]{1,64}$/i.test(summary.workerId) ? summary.workerId : undefined,
      links: safeLinks(summary.links),
      usage: summary.usage && {
        inputTokens: safeCount(summary.usage.inputTokens), outputTokens: safeCount(summary.usage.outputTokens), totalTokens: safeCount(summary.usage.totalTokens),
      },
    } : null,
  };
}
function safeLinks(links: AiOpsSummary['links']) {
  const safe = (url: unknown) => { try { const parsed = new URL(typeof url === 'string' ? url : ''); return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash ? parsed.toString() : undefined; } catch { return undefined; } };
  return links ? { pr: safe(links.pr), ci: safe(links.ci), staging: safe(links.staging) } : undefined;
}
function safeCount(n: unknown): number | undefined { return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : undefined; }

export async function enqueueAiOpsTask(input: { request: string; kind: AiOpsKind; actor: AiOpsPayload['actor']; workerId?: string; dedupeKey?: string }) {
  const now = new Date();
  const { dedupeKey, ...payloadInput } = input;
  const payload = parseAiOpsPayload(JSON.stringify({ version: 1, ...payloadInput, createdAt: now.toISOString() }));
  const summary: AiOpsSummary = { version: 1, kind: payload.kind, stage: 'queued', status: 'pending', updatedAt: now.toISOString() };
  return prisma.backgroundTask.create({ data: { type: AI_OPS_TYPE, payload: JSON.stringify(payload), result: JSON.stringify(summary), maxAttempts: 1, dedupeKey } });
}

// SQLite serializes writes. A competing read transaction that loses the write race fails
// rather than committing a second running task; callers may poll again.
export async function claimAiOpsTask(workerId: string, now = new Date()): Promise<BackgroundTask | null> {
  return prisma.$transaction(async (tx) => {
    if (await tx.backgroundTask.findFirst({ where: { type: AI_OPS_TYPE, status: 'running' }, select: { id: true } })) return null;
    const candidate = await tx.backgroundTask.findFirst({ where: { type: AI_OPS_TYPE, status: 'pending', attempts: 0, runAt: { lte: now } }, orderBy: [{ priority: 'desc' }, { runAt: 'asc' }, { createdAt: 'asc' }] });
    if (!candidate) return null;
    const claimed = await tx.backgroundTask.updateMany({ where: { id: candidate.id, type: AI_OPS_TYPE, status: 'pending', attempts: 0 }, data: { status: 'running', attempts: { increment: 1 }, maxAttempts: 1, lockedAt: now, lockedBy: workerId } });
    return claimed.count === 1 ? tx.backgroundTask.findUnique({ where: { id: candidate.id } }) : null;
  });
}

export async function updateAiOpsProgress(id: string, workerId: string, summary: AiOpsSummary, terminal?: 'succeeded' | 'failed'): Promise<boolean> {
  const updated = await prisma.backgroundTask.updateMany({
    where: { id, type: AI_OPS_TYPE, status: 'running', lockedBy: workerId },
    data: { result: JSON.stringify({ ...summary, version: 1, updatedAt: new Date().toISOString() }), ...(terminal ? { status: terminal, completedAt: new Date(), lockedBy: null, lockedAt: null } : {}) },
  });
  return updated.count === 1;
}

export async function cancelAiOpsTask(id: string): Promise<boolean> {
  const task = await prisma.backgroundTask.findFirst({ where: { id, type: AI_OPS_TYPE, status: { in: ['pending', 'running'] } } });
  if (!task) return false;
  const previous = parseAiOpsSummary(task.result);
  let kind: AiOpsKind = previous?.kind ?? 'engineering';
  if (!previous) { try { kind = parseAiOpsPayload(task.payload).kind; } catch { /* retain safe fallback */ } }
  const summary: AiOpsSummary = { version: 1, kind, stage: task.status === 'running' ? 'needs_reconciliation' : 'cancelled', status: 'failed', cancelled: true, updatedAt: new Date().toISOString(), workerId: previous?.workerId && /^[a-z0-9_-]{1,64}$/i.test(previous.workerId) ? previous.workerId : undefined, failureCode: task.status === 'running' ? 'execution_unknown' : undefined, links: safeLinks(previous?.links), usage: previous?.usage && { inputTokens: safeCount(previous.usage.inputTokens), outputTokens: safeCount(previous.usage.outputTokens), totalTokens: safeCount(previous.usage.totalTokens) } };
  const updated = await prisma.backgroundTask.updateMany({ where: { id, type: AI_OPS_TYPE, status: task.status, lockedBy: task.lockedBy, result: task.result }, data: { status: 'failed', result: JSON.stringify(summary), completedAt: new Date(), lockedAt: null, lockedBy: null } });
  return updated.count === 1;
}

export async function recoverStaleAiOpsTasks(now = new Date(), leaseMs = 15 * 60 * 1000): Promise<number> {
  const stale = await prisma.backgroundTask.findMany({ where: { type: AI_OPS_TYPE, status: 'running', lockedAt: { lt: new Date(now.getTime() - leaseMs) } } });
  let count = 0;
  for (const task of stale) {
    const prev = parseAiOpsSummary(task.result);
    const summary: AiOpsSummary = { version: 1, kind: prev?.kind ?? 'engineering', stage: 'needs_reconciliation', status: 'failed', updatedAt: now.toISOString(), workerId: prev?.workerId && /^[a-z0-9_-]{1,64}$/i.test(prev.workerId) ? prev.workerId : undefined, failureCode: 'runner_offline', links: safeLinks(prev?.links), usage: prev?.usage && { inputTokens: safeCount(prev.usage.inputTokens), outputTokens: safeCount(prev.usage.outputTokens), totalTokens: safeCount(prev.usage.totalTokens) } };
    const result = await prisma.backgroundTask.updateMany({ where: { id: task.id, type: AI_OPS_TYPE, status: 'running', lockedBy: task.lockedBy, lockedAt: task.lockedAt, result: task.result }, data: { status: 'failed', result: JSON.stringify(summary), completedAt: now, lockedBy: null, lockedAt: null } });
    count += result.count;
  }
  return count;
}
