/** Browser-only persistence for a checkout retry correlation key. */
export interface CheckoutAttemptRecord {
  attemptId: string;
  intentDigest: string;
}

const STORAGE_PREFIX = 'libereal:checkout-attempt:';

function storageKey(operation: string): string {
  return `${STORAGE_PREFIX}${operation}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

async function digestIntent(intent: unknown): Promise<string> {
  const source = stableJson(intent);
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const bytes = new TextEncoder().encode(source);
    const hash = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  // Test/legacy browser fallback. The digest is only a change detector, never an auth token.
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function newAttemptId(): string {
  return typeof window !== 'undefined' && window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `checkout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function getOrCreateCheckoutAttempt(operation: string, intent: unknown): Promise<CheckoutAttemptRecord> {
  const intentDigest = await digestIntent(intent);
  const key = storageKey(operation);
  if (typeof window === 'undefined') return { attemptId: newAttemptId(), intentDigest };
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw) {
      const current = JSON.parse(raw) as Partial<CheckoutAttemptRecord>;
      if (current.attemptId && current.intentDigest === intentDigest) return { attemptId: current.attemptId, intentDigest };
    }
    const next = { attemptId: newAttemptId(), intentDigest };
    window.sessionStorage.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    return { attemptId: newAttemptId(), intentDigest };
  }
}

export function clearCheckoutAttempt(operation: string): void {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(storageKey(operation)); } catch {}
}

export function checkoutAttemptStorageKey(operation: string): string { return storageKey(operation); }
