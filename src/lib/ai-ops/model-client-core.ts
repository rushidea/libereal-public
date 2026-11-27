import { createHash, randomUUID } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
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
  reserve(policy: AiOpsPolicy, call: { id: string; taskId: string; stage: string; inputHash: string; startedAt: string; leaseId?: string }): Promise<void>;
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
    await input.beforeSend?.();
    if (input.signal?.aborted) throw new Error('aiops_model_aborted');
    try { response = await deps.transport(body, key, input.signal); }
    catch { throw new Error('aiops_model_attempt_failed'); }
    const parsed = parseModelResponse(response, input.maxOutputTokens);
    const { value, ...safe } = parsed;
    await deps.ledger.settle(policy, callId, { ...safe, inputHash });
    return { ...parsed, inputHash, value };
  };
}
