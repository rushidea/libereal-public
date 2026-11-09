import { createHash, randomUUID } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { prisma } from '@/lib/prisma';
import { AI_OPS_MODEL, CALL_RESERVATION_NANOUSD, parseAiOpsPolicy, type AiOpsPolicy } from './policy';

const CONTEXT_LIMIT = 1_050_000;
const OUTPUT_LIMIT = 128_000;
const RESPONSE_BYTE_LIMIT = 1_048_576;
const TIMEOUT_MS = 120_000;
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export type ModelUsage = { inputTokens: number; outputTokens: number; totalTokens: number };
export type ModelResult = { value: unknown; usage: ModelUsage; responseId: string; inputHash: string; outputHash: string; estimatedUpperNanousd: number };
export type ModelInput = { taskId: string; stage: string; instructions: string; input: unknown; schema: Record<string, unknown>; maxOutputTokens: number; signal?: AbortSignal; beforeSend?: () => Promise<void> };
export type ModelTransport = (body: string, key: string, signal?: AbortSignal) => Promise<unknown>;
export type BudgetLedger = {
  reserve(policy: AiOpsPolicy, call: { id: string; taskId: string; stage: string; inputHash: string; startedAt: string }): Promise<void>;
  settle(policy: AiOpsPolicy, callId: string, result: Omit<ModelResult, 'value'>): Promise<void>;
};

// No SDK defaults, proxy, redirect, retry, dynamic endpoint or TLS override.
export const sendOpenAiResponse: ModelTransport = (body, key, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new Error('aiops_model_aborted')); return; }
  let settled = false;
  const finish = (error?: Error, value?: unknown) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (error) reject(error); else resolve(value);
  };
  const req = httpsRequest({ hostname: 'api.openai.com', port: 443, path: '/v1/responses', method: 'POST', rejectUnauthorized: true,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, (res) => {
    if (res.statusCode !== 200) { res.resume(); finish(new Error('aiops_provider_rejected')); return; }
    let size = 0;
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > RESPONSE_BYTE_LIMIT) { req.destroy(); finish(new Error('aiops_response_too_large')); return; }
      chunks.push(chunk);
    });
    res.on('error', () => finish(new Error('aiops_provider_transport_failed')));
    res.on('end', () => {
      if (settled) return;
      try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish(new Error('aiops_provider_invalid_json')); }
    });
  });
  const abort = () => { req.destroy(); finish(new Error('aiops_model_aborted')); };
  const timer = setTimeout(() => { req.destroy(); finish(new Error('aiops_model_timeout')); }, TIMEOUT_MS);
  req.on('error', () => finish(new Error('aiops_provider_transport_failed')));
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort(); else req.end(body);
});

type LedgerState = { version: 1; scope: string; limit: number; consumed: number };
function ledgerState(payload: string, policy: AiOpsPolicy): LedgerState {
  const state = JSON.parse(payload) as LedgerState;
  if (state.version !== 1 || state.scope !== policy.budgetScope || state.limit !== policy.maxBudgetNanousd || !Number.isSafeInteger(state.consumed) || state.consumed < 0 || state.consumed > state.limit) throw new Error('aiops_budget_state_invalid');
  return state;
}
const budgetId = (policy: AiOpsPolicy) => `aiops-budget-${sha256(policy.budgetScope)}`;
export const persistentBudgetLedger: BudgetLedger = {
  async reserve(policy, call) {
    await prisma.$transaction(async (tx) => {
      const id = budgetId(policy);
      let row = await tx.backgroundTask.findUnique({ where: { id } });
      if (!row) row = await tx.backgroundTask.create({ data: { id, type: 'aiops.control.budget', status: 'succeeded', maxAttempts: 1,
        payload: JSON.stringify({ version: 1, scope: policy.budgetScope, limit: policy.maxBudgetNanousd, consumed: 0 }), completedAt: new Date() } });
      if (row.type !== 'aiops.control.budget' || row.status !== 'succeeded') throw new Error('aiops_budget_state_invalid');
      const state = ledgerState(row.payload, policy);
      if (state.consumed + CALL_RESERVATION_NANOUSD > state.limit) throw new Error('aiops_budget_exhausted');
      const changed = await tx.backgroundTask.updateMany({ where: { id, payload: row.payload }, data: { payload: JSON.stringify({ ...state, consumed: state.consumed + CALL_RESERVATION_NANOUSD }) } });
      if (changed.count !== 1) throw new Error('aiops_budget_conflict');
      await tx.backgroundTask.create({ data: { id: call.id, type: 'aiops.control.call', status: 'succeeded', maxAttempts: 1,
        payload: JSON.stringify({ version: 1, scope: policy.budgetScope, ...call, callStarted: true, reservationNanousd: CALL_RESERVATION_NANOUSD, settlement: 'unknown' }), completedAt: new Date() } });
    });
  },
  async settle(policy, callId, result) {
    await prisma.$transaction(async (tx) => {
      const call = await tx.backgroundTask.findUnique({ where: { id: callId } });
      if (!call || call.type !== 'aiops.control.call') throw new Error('aiops_budget_call_missing');
      const started = JSON.parse(call.payload) as { scope?: string; settlement?: string };
      if (started.scope !== policy.budgetScope || started.settlement !== 'unknown') throw new Error('aiops_budget_call_invalid');
      const id = budgetId(policy);
      const row = await tx.backgroundTask.findUnique({ where: { id } });
      if (!row) throw new Error('aiops_budget_state_invalid');
      const state = ledgerState(row.payload, policy);
      if (state.consumed < CALL_RESERVATION_NANOUSD || !Number.isSafeInteger(result.estimatedUpperNanousd) || result.estimatedUpperNanousd < 0 || result.estimatedUpperNanousd > CALL_RESERVATION_NANOUSD) throw new Error('aiops_budget_settlement_invalid');
      const changed = await tx.backgroundTask.updateMany({ where: { id, payload: row.payload }, data: { payload: JSON.stringify({ ...state, consumed: state.consumed - CALL_RESERVATION_NANOUSD + result.estimatedUpperNanousd }) } });
      if (changed.count !== 1) throw new Error('aiops_budget_conflict');
      await tx.backgroundTask.update({ where: { id: callId }, data: { payload: JSON.stringify({ ...started, settlement: 'usage_upper_estimate' }), result: JSON.stringify(result) } });
    });
  },
};

function count(n: unknown): number {
  if (!Number.isSafeInteger(n) || (n as number) < 0) throw new Error('aiops_provider_usage_invalid');
  return n as number;
}
export function parseModelResponse(value: unknown, maxOutputTokens: number): { value: unknown; usage: ModelUsage; responseId: string; outputHash: string; estimatedUpperNanousd: number } {
  if (!value || typeof value !== 'object') throw new Error('aiops_provider_response_invalid');
  const p = value as Record<string, unknown>;
  if (p.model !== AI_OPS_MODEL || p.service_tier !== 'default' || p.status !== 'completed' || typeof p.id !== 'string' || !/^resp_[A-Za-z0-9_-]{1,160}$/.test(p.id) || !Array.isArray(p.output) || p.output.length !== 1) throw new Error('aiops_provider_identity_invalid');
  const message = p.output[0] as Record<string, unknown>;
  if (!message || message.type !== 'message' || message.role !== 'assistant' || message.status !== 'completed' || !Array.isArray(message.content) || message.content.length !== 1) throw new Error('aiops_provider_output_invalid');
  const content = message.content[0] as Record<string, unknown>;
  if (!content || content.type !== 'output_text' || typeof content.text !== 'string' || content.text.length > 131_072) throw new Error('aiops_provider_output_invalid');
  const u = p.usage as Record<string, unknown> | undefined;
  if (!u) throw new Error('aiops_provider_usage_invalid');
  const usage = { inputTokens: count(u.input_tokens), outputTokens: count(u.output_tokens), totalTokens: count(u.total_tokens) };
  if (usage.totalTokens !== usage.inputTokens + usage.outputTokens || usage.totalTokens > CONTEXT_LIMIT || usage.outputTokens > maxOutputTokens) throw new Error('aiops_provider_usage_invalid');
  // Highest documented long-context cache-write input rate + output, including 10% region uplift.
  // This is a conservative usage estimate, never an invoice or refund of an unknown attempt.
  const estimatedUpperNanousd = usage.inputTokens * 550 + usage.outputTokens * 825;
  if (estimatedUpperNanousd > CALL_RESERVATION_NANOUSD) throw new Error('aiops_provider_cost_invalid');
  let parsed: unknown;
  try { parsed = JSON.parse(content.text); } catch { throw new Error('aiops_provider_output_invalid'); }
  return { value: parsed, usage, responseId: p.id, outputHash: sha256(content.text), estimatedUpperNanousd };
}

// Dependency injection is for tests of the I/O boundaries; the production composition below
// always binds the fixed HTTPS transport and durable Prisma ledger.
export function createBudgetedModelClient(deps: { ledger: BudgetLedger; transport: ModelTransport; key: () => string | undefined }) {
  return async (policy: AiOpsPolicy, input: ModelInput): Promise<ModelResult> => {
    parseAiOpsPolicy(policy);
    const key = deps.key()?.trim();
    if (!key) throw new Error('aiops_provider_not_configured');
    if (input.signal?.aborted) throw new Error('aiops_model_aborted');
    if (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 16 || input.maxOutputTokens > OUTPUT_LIMIT) throw new Error('aiops_output_limit_invalid');
    const body = JSON.stringify({ model: AI_OPS_MODEL, store: false, stream: false, tools: [], tool_choice: 'none', reasoning: { effort: 'none' }, service_tier: 'default',
      instructions: input.instructions, input: JSON.stringify(input.input), max_output_tokens: input.maxOutputTokens,
      text: { format: { type: 'json_schema', name: 'aiops_result', strict: true, schema: input.schema } },
    });
    if (Buffer.byteLength(body) > 100_000) throw new Error('aiops_input_too_large');
    const inputHash = sha256(body);
    const callId = `aiops-call-${randomUUID()}`;
    await deps.ledger.reserve(policy, { id: callId, taskId: input.taskId, stage: input.stage, inputHash, startedAt: new Date().toISOString() });
    // No retry even on timeout, malformed output, settlement failure or cancellation.
    let response: unknown;
    try { await input.beforeSend?.(); if (input.signal?.aborted) throw new Error(); response = await deps.transport(body, key, input.signal); }
    catch { throw new Error('aiops_model_attempt_failed'); }
    const parsed = parseModelResponse(response, input.maxOutputTokens);
    const { value, ...safe } = parsed;
    await deps.ledger.settle(policy, callId, { ...safe, inputHash });
    return { ...parsed, inputHash, value };
  };
}
export const callAiOpsModel = createBudgetedModelClient({ ledger: persistentBudgetLedger, transport: sendOpenAiResponse, key: () => process.env.OPENAI_API_KEY });
