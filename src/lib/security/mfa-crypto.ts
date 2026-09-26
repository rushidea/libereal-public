import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const AES_ALGORITHM = 'aes-256-gcm';
const AES_NONCE_BYTES = 12;
const AES_TAG_BYTES = 16;
const AES_KEY_BYTES = 32;

export interface MfaKeyRing {
  currentVersion: number;
  keys: ReadonlyMap<number, Buffer>;
}

export interface MfaRecoveryPepperRing {
  currentVersion: number;
  peppers: ReadonlyMap<number, string>;
}

function assertKey(value: Buffer, version: number): Buffer {
  if (value.length !== AES_KEY_BYTES) {
    throw new Error(`MFA_KEY_V${version}_INVALID_LENGTH`);
  }
  return Buffer.from(value);
}

function decodeEnvKey(value: string, version: number): Buffer {
  const key = Buffer.from(value.trim(), 'base64');
  return assertKey(key, version);
}

export function createMfaKeyRing(input: {
  currentVersion: number;
  keys: Record<number, Buffer>;
}): MfaKeyRing {
  if (!Number.isInteger(input.currentVersion) || input.currentVersion < 1) {
    throw new Error('MFA_KEY_CURRENT_INVALID');
  }

  const keys = new Map<number, Buffer>();
  for (const [versionText, value] of Object.entries(input.keys)) {
    const version = Number(versionText);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error('MFA_KEY_VERSION_INVALID');
    }
    keys.set(version, assertKey(value, version));
  }

  if (!keys.has(input.currentVersion)) {
    throw new Error(`MFA_KEY_V${input.currentVersion}_MISSING`);
  }

  return { currentVersion: input.currentVersion, keys };
}

/** Loads only versioned MFA keys; it never falls back to AUTH_SECRET. */
export function loadMfaKeyRing(env: NodeJS.ProcessEnv = process.env): MfaKeyRing {
  const currentVersion = Number(env.MFA_KEY_CURRENT ?? '1');
  const keys: Record<number, Buffer> = {};

  for (const [name, value] of Object.entries(env)) {
    const match = /^MFA_KEY_V(\d+)$/.exec(name);
    if (!match || !value?.trim()) continue;
    const version = Number(match[1]);
    keys[version] = decodeEnvKey(value, version);
  }

  return createMfaKeyRing({ currentVersion, keys });
}

export function createMfaRecoveryPepperRing(input: {
  currentVersion: number;
  peppers: Record<number, string>;
}): MfaRecoveryPepperRing {
  if (!Number.isInteger(input.currentVersion) || input.currentVersion < 1) throw new Error('MFA_RECOVERY_PEPPER_VERSION_INVALID');
  const peppers = new Map<number, string>();
  for (const [versionText, pepper] of Object.entries(input.peppers)) {
    const version = Number(versionText);
    if (!Number.isInteger(version) || version < 1 || !pepper?.trim()) throw new Error('MFA_RECOVERY_PEPPER_INVALID');
    peppers.set(version, pepper.trim());
  }
  if (!peppers.has(input.currentVersion)) throw new Error(`MFA_RECOVERY_PEPPER_V${input.currentVersion}_MISSING`);
  return { currentVersion: input.currentVersion, peppers };
}

/** Loads versioned recovery-code peppers; the legacy variable is V1 only. */
export function loadMfaRecoveryPepperRing(env: NodeJS.ProcessEnv = process.env): MfaRecoveryPepperRing {
  const currentVersion = Number(env.MFA_RECOVERY_PEPPER_CURRENT ?? '1');
  const peppers: Record<number, string> = {};
  for (const [name, value] of Object.entries(env)) {
    const match = /^MFA_RECOVERY_PEPPER_V(\d+)$/.exec(name);
    if (match && value?.trim()) peppers[Number(match[1])] = value.trim();
  }
  if (!peppers[1] && env.MFA_RECOVERY_PEPPER?.trim()) peppers[1] = env.MFA_RECOVERY_PEPPER.trim();
  return createMfaRecoveryPepperRing({ currentVersion, peppers });
}

export function encryptMfaSecret(secret: string, keyRing: MfaKeyRing): string {
  const key = keyRing.keys.get(keyRing.currentVersion);
  if (!key) throw new Error(`MFA_KEY_V${keyRing.currentVersion}_MISSING`);

  const nonce = randomBytes(AES_NONCE_BYTES);
  const cipher = createCipheriv(AES_ALGORITHM, key, nonce);
  const aad = `libereal:mfa-secret:${keyRing.currentVersion}`;
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    String(keyRing.currentVersion),
    nonce.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join(':');
}

export function decryptMfaSecret(encrypted: string, keyRing: MfaKeyRing): string {
  const parts = encrypted.split(':');
  if (parts.length !== 4) throw new Error('MFA_SECRET_FORMAT_INVALID');

  const version = Number(parts[0]);
  if (!Number.isInteger(version) || version < 1) throw new Error('MFA_SECRET_VERSION_INVALID');
  const key = keyRing.keys.get(version);
  if (!key) throw new Error(`MFA_KEY_V${version}_MISSING`);

  const nonce = Buffer.from(parts[1], 'base64url');
  const ciphertext = Buffer.from(parts[2], 'base64url');
  const tag = Buffer.from(parts[3], 'base64url');
  if (nonce.length !== AES_NONCE_BYTES || tag.length !== AES_TAG_BYTES) {
    throw new Error('MFA_SECRET_PAYLOAD_INVALID');
  }

  const decipher = createDecipheriv(AES_ALGORITHM, key, nonce);
  decipher.setAAD(Buffer.from(`libereal:mfa-secret:${version}`));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function reencryptMfaSecret(encrypted: string, keyRing: MfaKeyRing): string {
  const version = Number(encrypted.split(':', 1)[0]);
  const plaintext = decryptMfaSecret(encrypted, keyRing);
  return version === keyRing.currentVersion ? encrypted : encryptMfaSecret(plaintext, keyRing);
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

export function hashMfaRecoveryCode(code: string, pepper: string): string {
  if (!pepper) throw new Error('MFA_RECOVERY_PEPPER_MISSING');
  return createHmac('sha256', pepper).update(normalizeRecoveryCode(code)).digest('hex');
}

export function hashMfaRecoveryCodeWithVersion(code: string, pepper: string, version: number): string {
  if (!Number.isInteger(version) || version < 1) throw new Error('MFA_RECOVERY_PEPPER_VERSION_INVALID');
  return `v${version}:${hashMfaRecoveryCode(code, pepper)}`;
}
