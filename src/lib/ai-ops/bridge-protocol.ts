import { AI_OPS_STAGES, type AiOpsStage } from './contracts';
import type { ModelResult } from './model-client-core';
export const ENGINEERING_STAGES: AiOpsStage[] = ['proposal', 'architecture', 'coding', 'review', 'pull_request', 'ci', 'staging', 'awaiting_production_approval'];
export type EngineeringLinks = { pr?: string; ci?: string; staging?: string };
export type EngineeringArtifacts = { publicCommit: string; privateCommit?: string; treeSha256?: string };
export type BridgeResult = { artifacts?: EngineeringArtifacts; terminalStage: 'needs_connection' | 'needs_reconciliation' | 'awaiting_production_approval'; links?: EngineeringLinks; safeErrorCode?: string };
export type BridgeScope = { model: 'gpt-6-luna'; budgetScope: string; maxBudgetNanousd: number; engineering: { repository: string; baseRef: string; baseBranch: string; allowedPaths: string[] } };
export type BridgeJob = { taskId: string; request: string; leaseId: string; scope: BridgeScope };
export type BridgeRequest =
  | { version: 1; op: 'claim'; runnerId: string; capabilities: { engineering: boolean; staging: boolean } }
  | { version: 1; op: 'checkpoint'; runnerId: string; taskId: string; leaseId: string; action: 'check' | 'progress'; progress?: { stage: AiOpsStage; links?: EngineeringLinks } }
  | { version: 1; op: 'checkpoint'; runnerId: string; taskId: string; leaseId: string; action: 'budget_reserve'; call: { id: string; stage: string; inputHash: string; startedAt: string } }
  | { version: 1; op: 'checkpoint'; runnerId: string; taskId: string; leaseId: string; action: 'budget_settle'; callId: string; result: Omit<ModelResult, 'value'> }
  | { version: 1; op: 'finish'; runnerId: string; taskId: string; leaseId: string; result: BridgeResult };
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const HASH = /^[a-f0-9]{64}$/;
export function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exact(p: Record<string, unknown>, required: string[], optional: string[] = []) { return required.every((k) => Object.hasOwn(p, k)) && Object.keys(p).every((k) => [...required, ...optional].includes(k)); }
export function safeEngineeringLinks(value: unknown, stagingUrl?: string): EngineeringLinks {
  if (!object(value) || !Object.keys(value).every((k) => ['pr', 'ci', 'staging'].includes(k))) throw new Error('aiops_bridge_invalid');
  const links: EngineeringLinks = {};
  if (value.pr !== undefined) { if (typeof value.pr !== 'string' || !/^https:\/\/github\.com\/rushidea\/libereal-public\/pull\/[0-9]+$/.test(value.pr)) throw new Error('aiops_bridge_invalid'); links.pr = value.pr; }
  if (value.ci !== undefined) { if (typeof value.ci !== 'string' || !/^https:\/\/github\.com\/rushidea\/libereal-public\/actions\/runs\/[0-9]+$/.test(value.ci)) throw new Error('aiops_bridge_invalid'); links.ci = value.ci; }
  if (value.staging !== undefined) { if (!stagingUrl || value.staging !== stagingUrl) throw new Error('aiops_bridge_invalid'); links.staging = stagingUrl; }
  return links;
}
export function validateSettlement(value: unknown): asserts value is Omit<ModelResult, 'value'> {
  if (!object(value) || !exact(value, ['responseId', 'inputHash', 'outputHash', 'usage', 'estimatedUpperNanousd']) || typeof value.responseId !== 'string' || !/^resp_[A-Za-z0-9_-]{1,160}$/.test(value.responseId) || typeof value.inputHash !== 'string' || !HASH.test(value.inputHash) || typeof value.outputHash !== 'string' || !HASH.test(value.outputHash) || !object(value.usage) || !exact(value.usage, ['inputTokens', 'outputTokens', 'totalTokens'])) throw new Error('aiops_budget_settlement_invalid');
  const u = value.usage;
  if (![u.inputTokens, u.outputTokens, u.totalTokens].every((n) => Number.isSafeInteger(n) && (n as number) >= 0) || u.totalTokens !== (u.inputTokens as number) + (u.outputTokens as number) || (u.totalTokens as number) > 1_050_000 || (u.outputTokens as number) > 128_000 || value.estimatedUpperNanousd !== (u.inputTokens as number) * 550 + (u.outputTokens as number) * 825 || (value.estimatedUpperNanousd as number) > 700_000_000) throw new Error('aiops_budget_settlement_invalid');
}
export function parseBridgeRequest(value: unknown, stagingUrl?: string): BridgeRequest {
  if (!object(value) || value.version !== 1 || typeof value.runnerId !== 'string' || !ID.test(value.runnerId)) throw new Error('aiops_bridge_invalid');
  if (value.op === 'claim') {
    if (!exact(value, ['version', 'op', 'runnerId', 'capabilities']) || !object(value.capabilities) || !exact(value.capabilities, ['engineering', 'staging']) || typeof value.capabilities.engineering !== 'boolean' || typeof value.capabilities.staging !== 'boolean') throw new Error('aiops_bridge_invalid');
  } else {
    if (typeof value.taskId !== 'string' || !ID.test(value.taskId) || typeof value.leaseId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.leaseId)) throw new Error('aiops_bridge_invalid');
    const base = ['version', 'op', 'runnerId', 'taskId', 'leaseId'];
    if (value.op === 'finish') {
      if (!exact(value, [...base, 'result']) || !object(value.result) || !exact(value.result, ['terminalStage'], ['links', 'safeErrorCode', 'artifacts']) || !['needs_connection', 'needs_reconciliation', 'awaiting_production_approval'].includes(value.result.terminalStage as string) || (value.result.safeErrorCode !== undefined && (typeof value.result.safeErrorCode !== 'string' || !(SAFE_ERROR_CODES as readonly string[]).includes(value.result.safeErrorCode)))) throw new Error('aiops_bridge_invalid');
      if (value.result.links !== undefined) safeEngineeringLinks(value.result.links, stagingUrl);
      const a = value.result.artifacts;
      if (a !== undefined && (!object(a) || !exact(a, ['publicCommit'], ['privateCommit', 'treeSha256']) || typeof a.publicCommit !== 'string' || !/^[a-f0-9]{40}$/.test(a.publicCommit) || (a.privateCommit !== undefined && (typeof a.privateCommit !== 'string' || !/^[a-f0-9]{40}$/.test(a.privateCommit))) || (a.treeSha256 !== undefined && (typeof a.treeSha256 !== 'string' || !HASH.test(a.treeSha256))))) throw new Error('aiops_bridge_invalid');
    } else if (value.op === 'checkpoint') {
      if (value.action === 'budget_reserve') {
        if (!exact(value, [...base, 'action', 'call']) || !object(value.call) || !exact(value.call, ['id', 'stage', 'inputHash', 'startedAt']) || typeof value.call.id !== 'string' || !/^aiops-call-[a-f0-9-]{36}$/.test(value.call.id) || !['architecture', 'coding', 'review'].includes(value.call.stage as string) || typeof value.call.inputHash !== 'string' || !HASH.test(value.call.inputHash) || typeof value.call.startedAt !== 'string' || !Number.isFinite(Date.parse(value.call.startedAt))) throw new Error('aiops_bridge_invalid');
      } else if (value.action === 'budget_settle') {
        if (!exact(value, [...base, 'action', 'callId', 'result']) || typeof value.callId !== 'string' || !/^aiops-call-[a-f0-9-]{36}$/.test(value.callId)) throw new Error('aiops_bridge_invalid');
        validateSettlement(value.result);
      } else if (value.action === 'check' || value.action === 'progress') {
        if (!exact(value, [...base, 'action'], value.action === 'progress' ? ['progress'] : []) || (value.action === 'progress' && (!object(value.progress) || !exact(value.progress, ['stage'], ['links']) || !ENGINEERING_STAGES.includes(value.progress.stage as AiOpsStage) || !AI_OPS_STAGES.includes(value.progress.stage as AiOpsStage)))) throw new Error('aiops_bridge_invalid');
        if (object(value.progress) && value.progress.links !== undefined) safeEngineeringLinks(value.progress.links, stagingUrl);
      } else throw new Error('aiops_bridge_invalid');
    } else throw new Error('aiops_bridge_invalid');
  }
  return value as BridgeRequest;
}
export const SAFE_ERROR_CODES = ['actor_inactive', 'permission_denied', 'budget_exhausted', 'provider_failed', 'invalid_model_output', 'engineering_review_findings', 'engineering_scope_invalid', 'engineering_ci_failed', 'staging_unavailable', 'staging_unknown', 'runner_offline', 'lease_lost', 'execution_unknown'] as const;
export function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'aiops_actor_inactive') return 'actor_inactive';
  if (/forbidden/.test(message)) return 'permission_denied';
  if (message === 'aiops_budget_exhausted') return 'budget_exhausted';
  if (/aiops_provider_(?:response_invalid|identity_invalid|output_invalid|usage_invalid|cost_invalid|invalid_json)|aiops_.*output|engineering_(?:plan|patch|review)_invalid/.test(message)) return 'invalid_model_output';
  if (/aiops_(?:provider|model_attempt)/.test(message)) return 'provider_failed';
  if (message === 'engineering_review_findings') return 'engineering_review_findings';
  if (/engineering_.*(?:scope|pin|changed|remote|base|context)/.test(message)) return 'engineering_scope_invalid';
  if (/staging/.test(message)) return 'staging_unknown';
  if (/lease|ownership|stopped/.test(message)) return 'lease_lost';
  return 'execution_unknown';
}
