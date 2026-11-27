export const AI_OPS_TYPE = 'aiops.run' as const;
export const AI_OPS_STAGES = [
  'queued', 'supervisor', 'business', 'proposal', 'architecture', 'coding',
  'review', 'pull_request', 'ci', 'staging', 'awaiting_production_approval',
  'complete', 'failed', 'cancelled', 'needs_reconciliation', 'needs_connection',
] as const;
export type AiOpsStage = typeof AI_OPS_STAGES[number];
export type AiOpsKind = 'auto' | 'business' | 'engineering';
export type AiOpsActor = { id: string; sessionId: string };
export type AiOpsPayload = {
  version: 1;
  request: string;
  kind: AiOpsKind;
  workerId?: string;
  actor: AiOpsActor;
  createdAt: string;
};
export type AiOpsSummary = {
  version: 1;
  workerId?: string;
  kind: AiOpsKind;
  stage: AiOpsStage;
  status: string;
  message?: string;
  failureCode?: string;
  updatedAt: string;
  cancelled?: boolean;
  output?: string;
  artifacts?: { publicCommit: string; privateCommit?: string; treeSha256?: string };
  links?: { pr?: string; ci?: string; staging?: string };
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
};
