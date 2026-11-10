import { isValidStagingResult } from '@/lib/ai-ops/engineering';
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  product: { count: vi.fn(), findMany: vi.fn() }, promotion: { groupBy: vi.fn() }, inquiry: { groupBy: vi.fn() }, order: { groupBy: vi.fn() }, shipment: { groupBy: vi.fn() }, legalDocument: { findMany: vi.fn() }, auditLog: { count: vi.fn() },
  backgroundTask: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  transaction: vi.fn(), permissions: vi.fn(), session: vi.fn(), requireAdmin: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { ...mocks, $transaction: mocks.transaction } }));
vi.mock('@/lib/session', () => ({ getAdminPermissions: mocks.permissions, requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/security/security-session-service', () => ({ getSecuritySessionState: mocks.session }));
import { readBusinessSnapshot, BUSINESS_WORKERS } from '@/lib/ai-ops/business-tools';
import { routeAiOpsRequest } from '@/lib/ai-ops/business';
import { createBudgetedModelClient, parseModelResponse, persistentBudgetLedger, type BudgetLedger, type ModelTransport } from '@/lib/ai-ops/model-client';
import { NextRequest } from 'next/server';
import { POST as enqueueRoute } from '@/app/api/admin/ai-ops/route';
import { GET as detailRoute } from '@/app/api/admin/ai-ops/[id]/route';
import { AI_OPS_MODEL, CALL_RESERVATION_NANOUSD, parseAiOpsPolicy } from '@/lib/ai-ops/policy';

const policy = parseAiOpsPolicy({ version: 1, enabled: true, model: AI_OPS_MODEL, budgetScope: 'synthetic-tests', maxBudgetNanousd: 1_400_000_000 });
const modelInput = { taskId: 'synthetic-task', stage: 'business', instructions: 'Synthetic test', input: { count: 3 }, schema: { type: 'object', additionalProperties: false, properties: { summary: { type: 'string' } }, required: ['summary'] }, maxOutputTokens: 1024 };
const response = () => ({ id: 'resp_synthetic', model: AI_OPS_MODEL, service_tier: 'default', status: 'completed',
  output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"summary":"Synthetic analysis"}' }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
});

beforeEach(() => { vi.clearAllMocks(); mocks.backgroundTask.findMany.mockResolvedValue([]); });

describe('AI business tool boundaries', () => {
  it('rejects a domain before touching the database without its current permission', async () => {
    await expect(readBusinessSnapshot('catalog', ['tasks.manage'])).rejects.toThrow('aiops_domain_forbidden');
    expect(mocks.product.count).not.toHaveBeenCalled();
    expect(mocks.product.findMany).not.toHaveBeenCalled();
  });
  it('queries a fixed public projection and strips unexpected private fields', async () => {
    mocks.product.count.mockResolvedValue(1);
    mocks.product.findMany.mockResolvedValue([{ name: 'Synthetic', brand: 'Test', catalogNumber: 'S-1', category: null, inStock: true, costPrice: 99, minimumSalePrice: 88, email: 'private@example.test' }]);
    const snapshot = await readBusinessSnapshot('catalog', ['products.read']);
    expect(mocks.product.findMany).toHaveBeenCalledWith({ select: { name: true, brand: true, catalogNumber: true, category: true, inStock: true }, orderBy: { updatedAt: 'desc' }, take: 12 });
    expect(JSON.stringify(snapshot)).not.toMatch(/costPrice|minimumSalePrice|email|private@example/);
    expect(snapshot.source).toBe('Product/public-catalog-projection');
    expect(snapshot.version).toBe(1);
  });
  it('implements all seven roles with read-only count/group/projection operations', async () => {
    for (const group of [mocks.promotion, mocks.inquiry, mocks.order, mocks.shipment]) group.groupBy.mockResolvedValue([{ status: 'pending', _count: { _all: 2 }, name: 'Must not escape' }]);
    mocks.product.count.mockResolvedValue(0); mocks.product.findMany.mockResolvedValue([]);
    mocks.legalDocument.findMany.mockResolvedValue([{ title: 'Synthetic', category: 'site', sitePath: '/legal', version: '1', description: 'Private extra' }]);
    mocks.auditLog.count.mockResolvedValue(3);
    for (const worker of BUSINESS_WORKERS) {
      const result = await readBusinessSnapshot(worker, ['products.read', 'pricing.read', 'inquiries.read', 'orders.read', 'content.read', 'audit.read']);
      expect(result.workerId).toBe(worker);
      expect(JSON.stringify(result)).not.toMatch(/Must not escape|Private extra/);
    }
    for (const group of [mocks.promotion, mocks.inquiry, mocks.order, mocks.shipment]) expect(group.groupBy).toHaveBeenCalledWith({ by: ['status'], _count: { _all: true } });
  });
  it('rejects a revoked actor before policy/model dispatch', async () => {
    mocks.user.findUnique.mockResolvedValue({ id: 'a', email: 'synthetic@example.test', role: 'admin', approvalStatus: 'approved', isBlacklisted: false, isFrozen: false });
    mocks.session.mockResolvedValue({ known: true, active: false });
    const active = vi.fn();
    await expect(routeAiOpsRequest({ taskId: 't', actor: { id: 'a', sessionId: 's' }, request: 'Analyze catalog', kind: 'auto', assertActive: active })).rejects.toThrow('aiops_actor_inactive');
    expect(active).not.toHaveBeenCalled();
    expect(mocks.backgroundTask.create).not.toHaveBeenCalled();
  });
});

describe('AI model HTTP boundary', () => {
  function client(transport: ModelTransport = async () => response(), ledger: BudgetLedger = { reserve: vi.fn(async () => {}), settle: vi.fn(async () => {}) }) {
    const boundary = vi.fn(transport);
    return { invoke: createBudgetedModelClient({ transport: boundary, ledger, key: () => 'synthetic-not-a-key' }), transport: boundary, ledger };
  }
  it('reserves before one fixed model request and records only safe usage/hashes', async () => {
    const c = client();
    const result = await c.invoke(policy, modelInput);
    expect(c.transport).toHaveBeenCalledTimes(1);
    expect((c.ledger.reserve as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(c.transport.mock.invocationCallOrder[0]);
    const body = JSON.parse(c.transport.mock.calls[0][0]);
    expect(body).toMatchObject({ model: AI_OPS_MODEL, store: false, stream: false, tools: [], tool_choice: 'none', reasoning: { effort: 'none' }, service_tier: 'default' });
    expect(body.text.format.strict).toBe(true);
    expect(body).not.toHaveProperty('api_key');
    expect(result.value).toEqual({ summary: 'Synthetic analysis' });
    expect(result.estimatedUpperNanousd).toBe(71_500);
    const safe = (c.ledger.settle as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(safe).not.toHaveProperty('value');
    expect(JSON.stringify(safe)).not.toContain('Synthetic analysis');
  });
  it('never retries or refunds an unknown transport outcome', async () => {
    const transport = vi.fn(async () => { throw new Error('synthetic upstream secret'); });
    const c = client(transport);
    await expect(c.invoke(policy, modelInput)).rejects.toThrow('aiops_model_attempt_failed');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(c.ledger.reserve).toHaveBeenCalledTimes(1);
    expect(c.ledger.settle).not.toHaveBeenCalled();
  });
  it('keeps reservation when canceled between reserve and HTTP', async () => {
    const c = client();
    await expect(c.invoke(policy, { ...modelInput, beforeSend: async () => { throw new Error('Task ownership lost'); } })).rejects.toThrow('Task ownership lost');
    expect(c.ledger.reserve).toHaveBeenCalledTimes(1);
    expect(c.transport).not.toHaveBeenCalled();
    expect(c.ledger.settle).not.toHaveBeenCalled();
  });
  it('rejects identity/tier mismatch and tool calls rather than accepting output', () => {
    expect(() => parseModelResponse({ ...response(), model: 'other-model' }, 1024)).toThrow('aiops_provider_identity_invalid');
    expect(() => parseModelResponse({ ...response(), service_tier: 'flex' }, 1024)).toThrow('aiops_provider_identity_invalid');
    expect(() => parseModelResponse({ ...response(), output: [{ type: 'function_call', name: 'write' }] }, 1024)).toThrow('aiops_provider_output_invalid');
    expect(() => parseModelResponse({ ...response(), usage: { input_tokens: 100, output_tokens: 20, total_tokens: 119 } }, 1024)).toThrow('aiops_provider_usage_invalid');
  });
});

describe('persistent AI budget control row', () => {
  const rows = new Map<string, { id: string; type: string; status: string; payload: string; result?: string }>();
  beforeEach(() => {
    rows.clear();
    mocks.backgroundTask.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null);
    mocks.backgroundTask.create.mockImplementation(async ({ data }: { data: { id: string; type: string; status: string; payload: string } }) => { if (rows.has(data.id)) throw new Error('Duplicate'); rows.set(data.id, { ...data }); return rows.get(data.id); });
    mocks.backgroundTask.updateMany.mockImplementation(async ({ where, data }: { where: { id: string; payload: string }; data: { payload: string } }) => { const row = rows.get(where.id); if (!row || row.payload !== where.payload) return { count: 0 }; Object.assign(row, data); return { count: 1 }; });
    mocks.backgroundTask.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { Object.assign(rows.get(where.id)!, data); return rows.get(where.id); });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const prior = structuredClone(rows);
      try { return await callback({ backgroundTask: mocks.backgroundTask }); }
      catch (error) { rows.clear(); for (const [id, row] of prior) rows.set(id, row); throw error; }
    });
  });
  const call = (id: string) => ({ id, taskId: 'synthetic-task', stage: 'supervisor', inputHash: 'a'.repeat(64), startedAt: '2026-01-01T00:00:00Z' });
  function consumed() { return JSON.parse([...rows.values()].find((r) => r.type === 'aiops.control.budget')!.payload).consumed; }
  it('durably records callStarted and refuses overspend without resetting unknown attempts', async () => {
    await persistentBudgetLedger.reserve(policy, call('call1'));
    await persistentBudgetLedger.reserve(policy, call('call2'));
    expect(consumed()).toBe(CALL_RESERVATION_NANOUSD * 2);
    expect(JSON.parse(rows.get('call1')!.payload)).toMatchObject({ callStarted: true, settlement: 'unknown', reservationNanousd: CALL_RESERVATION_NANOUSD });
    await expect(persistentBudgetLedger.reserve(policy, call('call3'))).rejects.toThrow('aiops_budget_exhausted');
    expect(consumed()).toBe(CALL_RESERVATION_NANOUSD * 2);
    expect(rows.has('call3')).toBe(false);
  });
  it('settles actual usage upper estimate once and forbids changing an existing scope limit', async () => {
    await persistentBudgetLedger.reserve(policy, call('call1'));
    await persistentBudgetLedger.settle(policy, 'call1', { responseId: 'resp_test', inputHash: 'a'.repeat(64), outputHash: 'b'.repeat(64), usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }, estimatedUpperNanousd: 71_500 });
    expect(consumed()).toBe(71_500);
    await expect(persistentBudgetLedger.settle(policy, 'call1', { responseId: 'resp_test', inputHash: '', outputHash: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, estimatedUpperNanousd: 0 })).rejects.toThrow('aiops_budget_call_invalid');
    await expect(persistentBudgetLedger.reserve({ ...policy, maxBudgetNanousd: 2_100_000_000 }, call('call2'))).rejects.toThrow('aiops_budget_state_invalid');
    expect(consumed()).toBe(71_500);
  });
  it('accepts only pinned host engineering configuration and exact safe file paths', () => {
    const engineering = { repository: 'rushidea/libereal-public', repositoryRoot: '/synthetic/repo', worktreesRoot: '/synthetic/worktrees', baseRef: 'a'.repeat(40), baseBranch: 'main', allowedPaths: ['src/app/page.tsx'], privateToolsRoot: '/synthetic/private-tools', privateToolsCommit: 'b'.repeat(40) };
    expect(parseAiOpsPolicy({ ...policy, engineering }).engineering).toEqual(engineering);
    const staging = { command: '/synthetic/private/operations/staging/aiops-entry.py', commandSha256: 'c'.repeat(64), configPath: '/synthetic/private/operations/staging/aiops-host.json', url: 'https://staging.example.test/', privateCommit: 'd'.repeat(40) };
    expect(parseAiOpsPolicy({ ...policy, engineering: { ...engineering, staging } }).engineering?.staging).toEqual(staging);
    const deployed = { status: 'deployed', publicCommit: 'e'.repeat(40), privateCommit: staging.privateCommit, treeSha256: 'f'.repeat(64), url: staging.url };
    const expected = { publicCommit: deployed.publicCommit, privateCommit: staging.privateCommit, url: staging.url };
    expect(isValidStagingResult(deployed, expected)).toBe(true);
    expect(isValidStagingResult({ ...deployed, privateCommit: '0'.repeat(40) }, expected)).toBe(false);
    expect(isValidStagingResult({ ...deployed, treeSha256: 'bad' }, expected)).toBe(false);
    expect(isValidStagingResult({ ...deployed, url: 'https://other.example/' }, expected)).toBe(false);
    expect(isValidStagingResult({ ...deployed, extra: true }, expected)).toBe(false);
    expect(() => parseAiOpsPolicy({ ...policy, engineering: { ...engineering, staging: { ...staging, configPath: 'relative' } } })).toThrow('aiops_engineering_policy_invalid');
    expect(() => parseAiOpsPolicy({ ...policy, engineering: { ...engineering, staging: { ...staging, extra: true } } })).toThrow('aiops_engineering_policy_invalid');
    for (const path of ['../escape.ts', 'src/lib/security/x.ts', '.env', 'src/app/*']) expect(() => parseAiOpsPolicy({ ...policy, engineering: { ...engineering, allowedPaths: [path] } })).toThrow('aiops_engineering_policy_invalid');
    expect(() => parseAiOpsPolicy({ ...policy, engineering: { ...engineering, command: 'arbitrary' } })).toThrow('aiops_engineering_policy_invalid');
  });
  it('rejects executable/endpoint overrides, other models and budgets above the authorized cap', () => {
    expect(() => parseAiOpsPolicy({ ...policy, endpoint: 'https://other.test' })).toThrow();
    expect(() => parseAiOpsPolicy({ ...policy, model: 'other-model' })).toThrow();
    expect(() => parseAiOpsPolicy({ ...policy, maxBudgetNanousd: 30_000_000_001 })).toThrow();
  });
});


describe('AI admin API projections', () => {
  beforeEach(() => {
    mocks.requireAdmin.mockResolvedValue({ id: 'synthetic-admin', email: 'synthetic@example.test', role: 'admin', sessionId: 'synthetic-current-session' });
    mocks.user.findUnique.mockResolvedValue({ id: 'synthetic-admin', email: 'synthetic@example.test', role: 'admin', approvalStatus: 'approved', isBlacklisted: false, isFrozen: false });
    mocks.session.mockResolvedValue({ known: true, active: true });
    mocks.permissions.mockResolvedValue(['admin.access', 'tasks.read', 'tasks.manage']);
  });
  it('rejects caller actor/permissions/model/endpoint injection before queue writes', async () => {
    for (const key of ['actor', 'permissions', 'model', 'endpoint']) {
      const result = await enqueueRoute(new NextRequest('http://localhost/api/admin/ai-ops', { method: 'POST', body: JSON.stringify({ request: 'Synthetic catalog analysis', [key]: 'forged' }) }));
      expect(result.status).toBe(400);
    }
    expect(mocks.backgroundTask.create).not.toHaveBeenCalled();
  });
  function task() {
    const stamp = new Date('2026-01-01T00:00:00Z');
    return { id: 'synthetic-task', type: 'aiops.run', status: 'succeeded', attempts: 1, createdAt: stamp, updatedAt: stamp, completedAt: stamp,
      payload: JSON.stringify({ version: 1, request: 'DO_NOT_EXPOSE_RAW_REQUEST', kind: 'auto', actor: { id: 'synthetic-admin', sessionId: 'DO_NOT_EXPOSE_OLD_SESSION' }, createdAt: stamp.toISOString() }),
      result: JSON.stringify({ version: 1, kind: 'business', workerId: 'catalog', stage: 'complete', status: 'succeeded', updatedAt: stamp.toISOString(), output: JSON.stringify({ version: 1, workerId: 'catalog', asOf: stamp.toISOString(), source: 'Product/public-catalog-projection', analysis: { summary: 'Synthetic output', draft: '', observations: [], limitations: [] } }) }),
      lastError: 'DO_NOT_EXPOSE_ERROR', lockedBy: 'DO_NOT_EXPOSE_LOCK_OWNER', dedupeKey: 'DO_NOT_EXPOSE_DEDUPE',
    };
  }
  it('withholds domain draft after permission revocation and excludes raw prompt/session/errors', async () => {
    mocks.backgroundTask.findFirst.mockResolvedValue(task());
    const result = await detailRoute(new NextRequest('http://localhost/api/admin/ai-ops/synthetic-task'), { params: Promise.resolve({ id: 'synthetic-task' }) });
    expect(result.status).toBe(200);
    const json = await result.json();
    expect(json).not.toHaveProperty('output');
    expect(JSON.stringify(json)).not.toContain('DO_NOT_EXPOSE');
  });
  it('returns only the owner draft with its currently authorized domain permission', async () => {
    mocks.permissions.mockResolvedValue(['admin.access', 'tasks.read', 'products.read']);
    mocks.backgroundTask.findFirst.mockResolvedValue(task());
    const result = await detailRoute(new NextRequest('http://localhost/api/admin/ai-ops/synthetic-task'), { params: Promise.resolve({ id: 'synthetic-task' }) });
    const json = await result.json();
    expect(JSON.parse(json.output).analysis.summary).toBe('Synthetic output');
    expect(JSON.stringify(json)).not.toContain('DO_NOT_EXPOSE');
    const other = task(); other.payload = other.payload.replace('synthetic-admin', 'other-admin');
    mocks.backgroundTask.findFirst.mockResolvedValue(other);
    const denied = await detailRoute(new NextRequest('http://localhost/api/admin/ai-ops/synthetic-task'), { params: Promise.resolve({ id: 'synthetic-task' }) });
    expect(denied.status).toBe(404);
  });
});
