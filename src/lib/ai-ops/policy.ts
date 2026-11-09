import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export const AI_OPS_MODEL = 'gpt-6-luna' as const;
export const CALL_RESERVATION_NANOUSD = 700_000_000;
export const MAX_BUDGET_NANOUSD = 30_000_000_000;
export type EngineeringPolicy = {
  repository: 'rushidea/libereal-public';
  repositoryRoot: string;
  worktreesRoot: string;
  baseRef: string;
  baseBranch: string;
  allowedPaths: string[];
  privateToolsRoot: string;
  privateToolsCommit: string;
  staging?: { command: string; commandSha256: string; url: string; privateCommit: string };
};
export type AiOpsPolicy = {
  version: 1;
  enabled: true;
  model: typeof AI_OPS_MODEL;
  budgetScope: string;
  maxBudgetNanousd: number;
  instructions?: string;
  engineering?: EngineeringPolicy;
};

export function parseAiOpsPolicy(value: unknown): AiOpsPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('aiops_policy_invalid');
  const p = value as Record<string, unknown>;
  const keys = ['version', 'enabled', 'model', 'budgetScope', 'maxBudgetNanousd', 'instructions', 'engineering'];
  if (Object.keys(p).some((key) => !keys.includes(key)) || p.version !== 1 || p.enabled !== true || p.model !== AI_OPS_MODEL ||
    typeof p.budgetScope !== 'string' || !/^[a-z0-9][a-z0-9_-]{7,63}$/.test(p.budgetScope) ||
    !Number.isSafeInteger(p.maxBudgetNanousd) || (p.maxBudgetNanousd as number) < CALL_RESERVATION_NANOUSD || (p.maxBudgetNanousd as number) > MAX_BUDGET_NANOUSD ||
    (p.instructions !== undefined && (typeof p.instructions !== 'string' || p.instructions.length > 16_000))) throw new Error('aiops_policy_invalid');
  if (p.engineering !== undefined) validateEngineeringPolicy(p.engineering);
  return p as AiOpsPolicy;
}


function validateEngineeringPolicy(value: unknown): asserts value is EngineeringPolicy {
  const fail = () => { throw new Error('aiops_engineering_policy_invalid'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const p = value as Record<string, unknown>;
  const required = ['repository', 'repositoryRoot', 'worktreesRoot', 'baseRef', 'baseBranch', 'allowedPaths', 'privateToolsRoot', 'privateToolsCommit'];
  if (Object.keys(p).some((key) => ![...required, 'staging'].includes(key)) || required.some((key) => !Object.hasOwn(p, key)) || p.repository !== 'rushidea/libereal-public') return fail();
  const absolutePath = (path: unknown) => typeof path === 'string' && path.length <= 1024 && !path.includes('\0') && isAbsolute(path);
  const safeRef = (ref: unknown) => typeof ref === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/.test(ref) && !ref.includes('..') && !ref.includes('//') && !ref.endsWith('.lock') && !ref.endsWith('/') && !ref.endsWith('.');
  if (![p.repositoryRoot, p.worktreesRoot, p.privateToolsRoot].every(absolutePath) || !safeRef(p.baseRef) || !safeRef(p.baseBranch) || typeof p.privateToolsCommit !== 'string' || !/^[a-f0-9]{40}$/.test(p.privateToolsCommit)) return fail();
  if (!Array.isArray(p.allowedPaths) || p.allowedPaths.length < 1 || p.allowedPaths.length > 16 || new Set(p.allowedPaths).size !== p.allowedPaths.length || p.allowedPaths.some((path) => typeof path !== 'string' || path.length > 240 || !/^[A-Za-z0-9_@()[\]./-]+$/.test(path) || path.startsWith('/') || path.endsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.')) || /(?:auth|session|permission|security|secret|credential|mfa|oauth|\.env|\.git)/i.test(path))) return fail();
  if (p.staging !== undefined) {
    const stage = p.staging as Record<string, unknown>;
    if (!stage || typeof stage !== 'object' || Array.isArray(stage) || Object.keys(stage).length !== 4 || !['command', 'commandSha256', 'url', 'privateCommit'].every((key) => Object.hasOwn(stage, key)) || !absolutePath(stage.command) || typeof stage.commandSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(stage.commandSha256) || typeof stage.privateCommit !== 'string' || !/^[a-f0-9]{40}$/.test(stage.privateCommit) || typeof stage.url !== 'string') return fail();
    try { const url = new URL(stage.url); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return fail(); } catch { return fail(); }
  }
}

// This is deliberately an explicit server-only JSON file, never executable configuration.
export async function loadAiOpsPolicy(): Promise<AiOpsPolicy | null> {
  const path = process.env.LIBEREAL_AIOPS_POLICY_PATH;
  if (!path) return null;
  try {
    if (!isAbsolute(path) || (await stat(path)).size > 65_536) throw new Error();
    return parseAiOpsPolicy(JSON.parse(await readFile(path, 'utf8')));
  } catch { throw new Error('aiops_policy_unavailable'); }
}

export async function aiOpsAvailability() {
  try {
    const policy = await loadAiOpsPolicy();
    return { available: Boolean(policy && process.env.OPENAI_API_KEY?.trim()), reason: !policy ? 'policy_not_configured' : !process.env.OPENAI_API_KEY?.trim() ? 'provider_not_configured' : null };
  } catch { return { available: false, reason: 'policy_unavailable' }; }
}
