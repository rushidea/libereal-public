// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';
const mock = vi.hoisted(() => ({ actor: vi.fn(), policy: vi.fn() }));
vi.mock('@/lib/ai-ops/business', () => ({ revalidateAiOpsActor: mock.actor }));
vi.mock('@/lib/ai-ops/policy', async (original) => ({ ...await original<typeof import('@/lib/ai-ops/policy')>(), loadAiOpsPolicy: mock.policy }));
import { prisma } from '@/lib/prisma';
import { handleEngineeringBridge, engineeringAvailability } from '@/lib/ai-ops/engineering-bridge';
import { parseBridgeRequest, validateSettlement } from '@/lib/ai-ops/bridge-protocol';
import { createBridgeClient, parseLocalRunnerConfig } from '@/lib/ai-ops/engineering-runner';
import { sha256, persistentBudgetLedger } from '@/lib/ai-ops/model-client';
import { taskModelAccounting } from '@/lib/ai-ops/model-accounting';
import { parseAiOpsPolicy } from '@/lib/ai-ops/policy';
const policy = parseAiOpsPolicy({ version: 1, enabled: true, model: 'gpt-6-luna', budgetScope: 'synthetic-bridge', maxBudgetNanousd: 30_000_000_000,
  engineering: { repository: 'rushidea/libereal-public', repositoryRoot: '/synthetic/public', worktreesRoot: '/synthetic/worktrees', baseRef: 'a'.repeat(40), baseBranch: 'codex/aiops-v1-current-staging', allowedPaths: ['src/app/page.tsx'], privateToolsRoot: '/synthetic/private', privateToolsCommit: 'b'.repeat(40) },
});
const runnerId = 'synthetic-runner';
async function job() {
  const parent = await prisma.backgroundTask.create({ data: { type: 'aiops.run', status: 'running', lockedBy: 'server-worker', lockedAt: new Date(), payload: JSON.stringify({ version: 1, request: 'Synthetic code request', kind: 'engineering', actor: { id: 'synthetic-admin', sessionId: 'MUST_NOT_LEAVE_SERVER' }, createdAt: new Date().toISOString() }) } });
  await prisma.backgroundTask.create({ data: { id: `aiops-engineering-${sha256(parent.id)}`, type: 'aiops.control.engineering', payload: JSON.stringify({ version: 1, taskId: parent.id, parentLock: 'server-worker' }), result: JSON.stringify({ stage: 'proposal' }), maxAttempts: 1 } });
  const claimed = await handleEngineeringBridge({ version: 1, op: 'claim', runnerId, capabilities: { engineering: true, staging: false } });
  if (!('job' in claimed) || !claimed.job) throw new Error('test claim failed');
  return { parent, claimed: claimed.job, base: { version: 1 as const, runnerId, taskId: parent.id, leaseId: claimed.job.leaseId } };
}
describe('SSH engineering bridge uses only server state and budget', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => { clearAllTables(getTestDb()); vi.clearAllMocks(); mock.policy.mockResolvedValue(policy); mock.actor.mockResolvedValue({ id: 'synthetic-admin', sessionId: 'MUST_NOT_LEAVE_SERVER', permissions: ['admin.access', 'tasks.manage'] }); });
  it('claims exactly once, returns no actor/session and reports heartbeat expiry', async () => {
    const j = await job();
    expect(JSON.stringify(j.claimed)).not.toContain('MUST_NOT_LEAVE_SERVER');
    expect(j.claimed).not.toHaveProperty('actor');
    const again = await handleEngineeringBridge({ version: 1, op: 'claim', runnerId, capabilities: { engineering: true, staging: false } });
    expect(again).toEqual({ ok: true, job: null });
    expect((await engineeringAvailability()).available).toBe(true);
    await prisma.backgroundTask.updateMany({ where: { type: 'aiops.control.runner' }, data: { lockedAt: new Date(0) } });
    expect(await engineeringAvailability()).toMatchObject({ available: false, reason: 'runner_offline' });
    await prisma.backgroundTask.updateMany({ where: { type: 'aiops.control.engineering' }, data: { lockedAt: new Date(0) } });
    await expect(handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'check' })).rejects.toThrow('aiops_bridge_lease_lost');
    expect(await handleEngineeringBridge({ version: 1, op: 'claim', runnerId, capabilities: { engineering: true, staging: false } })).toEqual({ ok: true, job: null });
  });
  it('fences wrong leases, revoked actors and cancelled parent tasks before model reservation', async () => {
    const j = await job();
    await expect(handleEngineeringBridge({ ...j.base, leaseId: randomUUID(), op: 'checkpoint', action: 'check' })).rejects.toThrow('aiops_bridge_lease_lost');
    mock.actor.mockRejectedValueOnce(new Error('aiops_actor_inactive'));
    await expect(handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'check' })).rejects.toThrow('aiops_actor_inactive');
    await prisma.backgroundTask.update({ where: { id: j.parent.id }, data: { status: 'failed' } });
    await expect(handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'check' })).rejects.toThrow('aiops_bridge_lease_lost');
    expect(await prisma.backgroundTask.count({ where: { type: 'aiops.control.call' } })).toBe(0);
  });
  it('uses one shared ledger, retains unknown reserves and permits settlement only once for the current lease', async () => {
    const j = await job();
    await handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'progress', progress: { stage: 'architecture' } });
    const call = { id: `aiops-call-${randomUUID()}`, stage: 'architecture', inputHash: 'a'.repeat(64), startedAt: new Date().toISOString() };
    await handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'budget_reserve', call });
    const control = await prisma.backgroundTask.findUniqueOrThrow({ where: { id: call.id } });
    expect(JSON.parse(control.payload)).toMatchObject({ taskId: j.parent.id, leaseId: j.base.leaseId, settlement: 'unknown', reservationNanousd: 700_000_000 });
    const result = { responseId: 'resp_synthetic', inputHash: call.inputHash, outputHash: 'b'.repeat(64), usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }, estimatedUpperNanousd: 71_500 };
    await handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'budget_settle', callId: call.id, result });
    await expect(handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'budget_settle', callId: call.id, result })).rejects.toThrow('aiops_budget_call_invalid');
    await persistentBudgetLedger.reserve(policy, { id: `aiops-call-${randomUUID()}`, taskId: j.parent.id, stage: 'supervisor', inputHash: 'c'.repeat(64), startedAt: new Date().toISOString() });
    const totals = await taskModelAccounting(j.parent.id);
    expect(totals).toMatchObject({ calls: 2, estimatedUpperNanousd: 71_500, unknownReservedNanousd: 700_000_000, usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } });
    expect(() => validateSettlement({ ...result, estimatedUpperNanousd: 0 })).toThrow();
  });
  it('preserves actual PR/CI links when finishing at an unconnected staging step', async () => {
    const j = await job();
    for (const stage of ['architecture', 'coding', 'review', 'pull_request', 'ci']) await handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'progress', progress: { stage } });
    const links = { pr: 'https://github.com/rushidea/libereal-public/pull/123', ci: 'https://github.com/rushidea/libereal-public/actions/runs/456' };
    await handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'progress', progress: { stage: 'ci', links } });
    await handleEngineeringBridge({ ...j.base, op: 'finish', result: { terminalStage: 'needs_connection' } });
    const row = await prisma.backgroundTask.findUniqueOrThrow({ where: { id: `aiops-engineering-${sha256(j.parent.id)}` } });
    expect(JSON.parse(row.result!).links).toEqual(links);
    await expect(handleEngineeringBridge({ ...j.base, op: 'finish', result: { terminalStage: 'needs_connection' } })).rejects.toThrow('aiops_bridge_lease_lost');
  });
});
describe('fixed SSH runner transport boundary', () => {
  it('rejects other operations/credentials and poisons a failed session without retrying', async () => {
    expect(() => parseBridgeRequest({ version: 1, op: 'sql', runnerId, sql: 'arbitrary' })).toThrow();
    expect(() => parseBridgeRequest({ version: 1, op: 'claim', runnerId, capabilities: { engineering: true, staging: false }, sessionId: 'forged' })).toThrow();
    const config = parseLocalRunnerConfig({ version: 1, runnerId, policyPath: '/synthetic/policy.json', ssh: { host: 'libereal-ecs', command: '/usr/local/libexec/libereal-aiops-bridge' } });
    const transport = vi.fn(async () => { throw new Error('unknown SSH outcome'); });
    const rpc = createBridgeClient(config, transport);
    const request = { version: 1 as const, op: 'claim' as const, runnerId, capabilities: { engineering: true, staging: false } };
    await expect(rpc(request)).rejects.toThrow('unknown SSH outcome');
    await expect(rpc(request)).rejects.toThrow('aiops_bridge_lease_lost');
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
