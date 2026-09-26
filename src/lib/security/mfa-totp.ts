import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STEP_SECONDS = 30;
const WINDOW_STEPS = 1;
const MIN_SECRET_BYTES = 20;

function decodeBase32(secret: string): Buffer {
  const normalized = secret.toUpperCase().replace(/[\s=-]/g, '');
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) throw new Error('INVALID_TOTP_SECRET');

  const output: number[] = [];
  let value = 0;
  let bits = 0;
  for (const character of normalized) {
    value = (value << 5) | (character.charCodeAt(0) >= 65
      ? character.charCodeAt(0) - 65
      : character.charCodeAt(0) - 24);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }
  const decoded = Buffer.from(output);
  if (decoded.length < MIN_SECRET_BYTES) throw new Error('TOTP_SECRET_TOO_SHORT');
  return decoded;
}

function encodeBase32(value: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let buffer = 0;
  let bits = 0;
  let output = '';
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(MIN_SECRET_BYTES));
}

export function buildTotpUri(secret: string, accountName: string, issuer = 'LIBEREAL'): string {
  const label = `${issuer}:${accountName}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

export function totpCodeAt(secret: string, nowMs: number, stepSeconds = STEP_SECONDS): string {
  const counter = BigInt(Math.floor(nowMs / 1000 / stepSeconds));
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | (digest[offset + 1] << 16)
    | (digest[offset + 2] << 8)
    | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

export function findTotpStep(
  secret: string,
  code: string,
  nowMs: number,
  stepSeconds = STEP_SECONDS,
  windowSteps = WINDOW_STEPS,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const currentStep = Math.floor(nowMs / 1000 / stepSeconds);
  for (let offset = -windowSteps; offset <= windowSteps; offset += 1) {
    const candidate = totpCodeAt(secret, (currentStep + offset) * stepSeconds * 1000, stepSeconds);
    const left = Buffer.from(candidate);
    const right = Buffer.from(code);
    if (timingSafeEqual(left, right)) return currentStep + offset;
  }
  return null;
}
