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
async function job(kind = 'engineering') {
  const parent = await prisma.backgroundTask.create({ data: {
    type: 'aiops.run', payload: JSON.stringify({ version: 1, request: 'Synthetic request', kind,
      actor: { id: 'synthetic-admin', sessionId: 'MUST_NOT_LEAVE_SERVER' }, createdAt: new Date().toISOString() }),
  } });
  const claimed = await handleEngineeringBridge({ version: 1, op: 'claim', runnerId,
    capabilities: { engineering: true, staging: false, business: true } });
  if (!('job' in claimed) || !claimed.job) throw new Error('test claim failed');
  const base = { version: 1 as const, runnerId, taskId: parent.id, leaseId: claimed.job.leaseId };
  if (kind === 'engineering') {
    await handleEngineeringBridge({ ...base, op: 'checkpoint', action: 'route', decision: { kind: 'engineering' } });
  }
  return { parent, claimed: claimed.job, base };
}
describe('SSH engineering bridge uses only server state and budget', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => { clearAllTables(getTestDb()); vi.clearAllMocks(); mock.policy.mockResolvedValue(policy); mock.actor.mockResolvedValue({ id: 'synthetic-admin', sessionId: 'MUST_NOT_LEAVE_SERVER', permissions: ['admin.access', 'tasks.manage'] }); });
  it('claims once and reconciles expired leases without replaying or refunding unknown requests', async () => {
    const j = await job();
    expect(JSON.stringify(j.claimed)).not.toContain('MUST_NOT_LEAVE_SERVER');
    expect(j.claimed).not.toHaveProperty('actor');
    const next = await prisma.backgroundTask.create({ data: {
      type: 'aiops.run', payload: j.parent.payload, maxAttempts: 1,
    } });
    const claim = { version: 1, op: 'claim', runnerId,
      capabilities: { engineering: true, staging: false, business: true } };
    expect(await handleEngineeringBridge(claim)).toEqual({ ok: true, job: null });
    expect((await engineeringAvailability()).available).toBe(true);
    const call = { id: `aiops-call-${randomUUID()}`, stage: 'supervisor',
      inputHash: 'c'.repeat(64), startedAt: new Date().toISOString() };
    await persistentBudgetLedger.reserve(policy, { ...call, taskId: j.parent.id, leaseId: j.base.leaseId });
    const ledgerBefore = await prisma.backgroundTask.findFirstOrThrow({ where: { type: 'aiops.control.budget' } });
    await prisma.backgroundTask.updateMany({ where: { type: 'aiops.control.runner' }, data: { lockedAt: new Date(0) } });
    expect(await engineeringAvailability()).toMatchObject({ available: false, reason: 'runner_offline' });
    await prisma.backgroundTask.update({ where: { id: j.parent.id }, data: { lockedAt: new Date(0) } });
    await expect(handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'check' }))
      .rejects.toThrow('aiops_bridge_lease_lost');
    const resumed = await handleEngineeringBridge(claim);
    expect(resumed).toMatchObject({ ok: true, job: { taskId: next.id } });
    const expired = await prisma.backgroundTask.findUniqueOrThrow({ where: { id: j.parent.id } });
    expect(expired).toMatchObject({ status: 'failed', attempts: 1, lockedBy: null, lockedAt: null });
    expect(JSON.parse(expired.result!)).toMatchObject({ stage: 'needs_reconciliation', failureCode: 'runner_offline' });
    const ledgerAfter = await prisma.backgroundTask.findUniqueOrThrow({ where: { id: ledgerBefore.id } });
    expect(ledgerAfter.payload).toBe(ledgerBefore.payload);
    const unknown = await prisma.backgroundTask.findUniqueOrThrow({ where: { id: call.id } });
    expect(JSON.parse(unknown.payload)).toMatchObject({ settlement: 'unknown', reservationNanousd: 700_000_000 });
    await expect(handleEngineeringBridge({ ...j.base, op: 'finish', result: { terminalStage: 'needs_reconciliation' } }))
      .rejects.toThrow('aiops_bridge_lease_lost');
    expect(await handleEngineeringBridge(claim)).toEqual({ ok: true, job: null });
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
  it('runs promotion snapshots without website model credentials or engineering policy and validates finish', async () => {
    mock.policy.mockResolvedValue({ ...policy, engineering: undefined });
    mock.actor.mockResolvedValue({ permissions: ['admin.access', 'tasks.manage', 'pricing.read'] });
    const j = await job('business');
    expect(j.claimed.scope.engineering).toBeUndefined();
    expect((await engineeringAvailability()).businessAvailable).toBe(true);
    const settle = async (stage: string) => {
      const call = { id: `aiops-call-${randomUUID()}`, stage,
        inputHash: 'a'.repeat(64), startedAt: new Date().toISOString() };
      await handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'budget_reserve', call });
      await handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'budget_settle', callId: call.id, result: {
        responseId: 'resp_synthetic', inputHash: call.inputHash, outputHash: 'b'.repeat(64),
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }, estimatedUpperNanousd: 71_500,
      } });
    };
    await settle('supervisor');
    await handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'route',
      decision: { kind: 'business', workerId: 'promotion' } });
    await expect(handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'snapshot', workerId: 'catalog' }))
      .rejects.toThrow('aiops_domain_invalid');
    const response = await handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'snapshot', workerId: 'promotion' });
    if (!('snapshot' in response) || !response.snapshot) throw new Error('snapshot missing');
    expect(response.snapshot).toMatchObject({ workerId: 'promotion', source: 'Promotion/status-counts', facts: [] });
    const output = { version: 1, workerId: 'promotion', asOf: response.snapshot.asOf, source: response.snapshot.source,
      analysis: { summary: 'Synthetic analysis', draft: '', observations: [], limitations: ['Aggregate only'] } };
    const finish = (value: unknown) => handleEngineeringBridge({ ...j.base, op: 'finish',
      result: { terminalStage: 'complete', output: JSON.stringify(value) } });
    await expect(finish({ ...output, source: 'forged' })).rejects.toThrow('aiops_business_output_invalid');
    await expect(finish(output)).rejects.toThrow('aiops_budget_call_invalid');
    await settle('business:promotion');
    await expect(finish({ ...output, analysis: { ...output.analysis, sql: 'forged' } }))
      .rejects.toThrow('aiops_business_output_invalid');
    mock.actor.mockResolvedValueOnce({ permissions: ['admin.access', 'tasks.manage'] });
    await expect(finish(output)).rejects.toThrow('aiops_domain_forbidden');
    await finish(output);
    const done = await prisma.backgroundTask.findUniqueOrThrow({ where: { id: j.parent.id } });
    expect(done.status).toBe('succeeded');
    expect(JSON.parse(done.result!)).toMatchObject({ stage: 'complete', status: 'succeeded',
      usage: { inputTokens: 200, outputTokens: 40, totalTokens: 240 } });
  });
  it('rejects a changed policy scope before reserving another call', async () => {
    const j = await job();
    mock.policy.mockResolvedValue({ ...policy, budgetScope: 'different-scope' });
    await expect(handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'check' }))
      .rejects.toThrow('engineering_scope_invalid');
    expect(await prisma.backgroundTask.count({ where: { type: 'aiops.control.call' } })).toBe(0);
  });
  it('preserves actual PR/CI links when finishing at an unconnected staging step', async () => {
    const j = await job();
    for (const stage of ['architecture', 'coding', 'review', 'pull_request', 'ci']) await handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'progress', progress: { stage } });
    const links = { pr: 'https://github.com/rushidea/libereal-public/pull/123', ci: 'https://github.com/rushidea/libereal-public/actions/runs/456' };
    await handleEngineeringBridge({ ...j.base, op: 'checkpoint', action: 'progress', progress: { stage: 'ci', links } });
    const artifacts = { publicCommit: 'a'.repeat(40), privateCommit: 'b'.repeat(40), treeSha256: 'c'.repeat(64) };
    await expect(handleEngineeringBridge({ ...j.base, op: 'finish', result: {
      terminalStage: 'needs_connection', artifacts: { ...artifacts, treeSha256: 'invalid' },
    } })).rejects.toThrow('aiops_bridge_invalid');
    await handleEngineeringBridge({ ...j.base, op: 'finish', result: { terminalStage: 'needs_connection', artifacts } });
    const row = await prisma.backgroundTask.findUniqueOrThrow({ where: { id: j.parent.id } });
    expect(JSON.parse(row.result!).links).toEqual(links);
    expect(JSON.parse(row.result!).artifacts).toEqual(artifacts);
    await expect(handleEngineeringBridge({ ...j.base, op: 'finish', result: { terminalStage: 'needs_connection' } })).rejects.toThrow('aiops_bridge_lease_lost');
  });
});
describe('fixed SSH runner transport boundary', () => {
  it('rejects other operations/credentials and poisons a failed session without retrying', async () => {
    expect(() => parseBridgeRequest({ version: 1, op: 'sql', runnerId, sql: 'arbitrary' })).toThrow();
    expect(() => parseBridgeRequest({ version: 1, op: 'claim', runnerId, capabilities: { engineering: true, staging: false }, sessionId: 'forged' })).toThrow();
    const config = parseLocalRunnerConfig({ version: 1, runnerId, policyPath: '/synthetic/policy.json', keyPath: '/synthetic/key.env', ssh: { configPath: '/synthetic/ssh-config', knownHostsPath: '/synthetic/known-hosts', host: 'libereal-ecs', command: '/usr/local/libexec/libereal-aiops-bridge' } });
    const transport = vi.fn(async () => { throw new Error('unknown SSH outcome'); });
    const rpc = createBridgeClient(config, transport);
    const request = { version: 1 as const, op: 'claim' as const, runnerId, capabilities: { engineering: true, staging: false } };
    await expect(rpc(request)).rejects.toThrow('unknown SSH outcome');
    await expect(rpc(request)).rejects.toThrow('aiops_bridge_lease_lost');
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
