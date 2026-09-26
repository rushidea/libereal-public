/**
 * Cryptographically secure ID generation.
 * - Server: uses globalThis.crypto.randomUUID() (Node 19+ / Web Crypto)
 * - Client (browser): uses crypto.randomUUID() (Web Crypto API)
 *
 * Format: `{prefix}_{uuid}` (e.g. `usr_550e8400-e29b-41d4-a716-446655440000`)
 * Replaces insecure `Date.now() + Math.random()` pattern.
 */

export function generateId(prefix: string = 'id'): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) {
    return `${prefix}_${cryptoObj.randomUUID()}`;
  }
  // Last-resort fallback (should never happen in supported runtimes)
  return `${prefix}_${fallbackUuid()}`;
}

function fallbackUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
