import Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types';
import { getDatabasePath } from '@/lib/databasePath';
import { getEphemeralStore, type EphemeralStore } from '@/lib/ephemeral-store';
import { hashChallengeForStorage, MFA_MAX_ATTEMPTS, recordMfaFailure, type MfaChallengeProvider } from './mfa-challenge-store';
import { hasUnifiedTables } from './unified-authenticator-store';
import { createMfaLoginChallenge, readMfaLoginChallengeContext } from './mfa-service';
import { enforceMfaChallengeCreationRateLimits, enforceMfaRateLimits, type MfaRateLimitStore } from './mfa-rate-limit';
import { issuePasskeyVerifiedToken, type PasskeyVerifiedLogin } from './passkey-session';
import { recordSecurityEvent } from './security-events';

const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export type PasskeyRegistrationResponse = Parameters<typeof verifyRegistrationResponse>[0]['response'];
export type PasskeyAuthenticationResponse = Parameters<typeof verifyAuthenticationResponse>[0]['response'];
export type PasskeyEphemeralStore = Pick<EphemeralStore, 'get' | 'set' | 'compareAndDelete'>;

export interface PasskeySummary {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface DiscoverablePasskeyLoginOptions {
  challengeId: string;
  options: unknown;
}

interface PasskeyConfig {
  rpId: string;
  rpName: string;
  origins: string[];
}

interface StoredCredentialData {
  publicKey: string;
  counter: number;
  deviceType?: string;
  backedUp?: boolean;
  transports?: AuthenticatorTransportFuture[];
}

interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  credential_data: string;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
}

function getPasskeyConfig(env: NodeJS.ProcessEnv = process.env): PasskeyConfig {
  const rpId = env.WEBAUTHN_RP_ID?.trim();
  const configuredOrigins = env.WEBAUTHN_ORIGINS?.trim();
  if (!rpId || !configuredOrigins) throw new Error('PASSKEY_CONFIG_MISSING');
  if (!/^[a-z0-9.-]+$/i.test(rpId) || rpId.includes('..')) throw new Error('PASSKEY_CONFIG_INVALID');
  const origins = configuredOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      const url = new URL(origin);
      const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (url.protocol !== 'https:' && !isLocal) throw new Error('PASSKEY_CONFIG_INVALID');
      if (url.hostname !== rpId && !url.hostname.endsWith(`.${rpId}`) && !isLocal) throw new Error('PASSKEY_CONFIG_INVALID');
      return url.origin;
    });
  if (origins.length === 0) throw new Error('PASSKEY_CONFIG_INVALID');
  return {
    rpId,
    rpName: env.WEBAUTHN_RP_NAME?.trim() || 'LIBEREAL',
    origins: [...new Set(origins)],
  };
}

function withDatabase<T>(callback: (db: Database.Database) => T): T {
  const db = new Database(getDatabasePath());
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function readOnlyDatabase<T>(callback: (db: Database.Database) => T): T {
  const db = new Database(getDatabasePath(), { readonly: true });
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function decode(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64url'));
}

function registrationKey(userId: string): string {
  return `passkey:register:${userId}`;
}

function loginKey(challengeId: string): string {
  return `passkey:login:${challengeId}`;
}

function ephemeralStore(store?: PasskeyEphemeralStore): PasskeyEphemeralStore {
  return store ?? getEphemeralStore();
}

function normalizeName(name: string | undefined): string {
  const normalized = name?.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80);
  return normalized || 'Passkey';
}

function parseCredentialData(raw: string): StoredCredentialData {
  const data = JSON.parse(raw) as Partial<StoredCredentialData>;
  const counter = data.counter;
  if (!data.publicKey || typeof data.publicKey !== 'string' || typeof counter !== 'number' || !Number.isInteger(counter) || counter < 0) {
    throw new Error('PASSKEY_CREDENTIAL_DATA_INVALID');
  }
  const allowedTransports = new Set<AuthenticatorTransportFuture>(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);
  return {
    publicKey: data.publicKey,
    counter,
    deviceType: typeof data.deviceType === 'string' ? data.deviceType : undefined,
    backedUp: typeof data.backedUp === 'boolean' ? data.backedUp : undefined,
    transports: Array.isArray(data.transports)
      ? data.transports.filter((item) => allowedTransports.has(item))
      : undefined,
  };
}

function listRows(userId: string): PasskeyRow[] {
  return readOnlyDatabase((db) => {
    if (!hasUnifiedTables(db)) return [];
    return db.prepare(`
      SELECT id, user_id, credential_id, credential_data, name, created_at, last_used_at
      FROM user_authenticators
      WHERE user_id = ? AND type = 'passkey' AND enabled = 1
      ORDER BY created_at ASC
    `).all(userId) as PasskeyRow[];
  });
}

export function listPasskeys(userId: string): PasskeySummary[] {
  return listRows(userId).map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }));
}

export async function createPasskeyLoginChallenge(input: {
  email: string;
  ip?: string | null;
}): Promise<{ challengeId: string; challengeToken: string }> {
  const email = input.email.trim().toLowerCase();
  const user = readOnlyDatabase((db) => {
    const row = db.prepare(`
      SELECT id
      FROM User
      WHERE lower(email) = ?
        AND EXISTS (
          SELECT 1 FROM user_authenticators
          WHERE user_id = User.id AND type = 'passkey' AND enabled = 1
        )
    `).get(email) as { id: string } | undefined;
    return row;
  });
  if (!user) throw new Error('PASSKEY_LOGIN_USER_NOT_FOUND');

  const challenge = await createMfaLoginChallenge(user.id, 'credentials', input.ip);
  return { challengeId: challenge.id, challengeToken: challenge.token };
}

function discoverableLoginKey(challengeId: string): string {
  return `passkey:discoverable-login:${challengeId}`;
}

export async function createDiscoverablePasskeyLoginOptions(input: {
  ip?: string | null;
  store?: PasskeyEphemeralStore;
  rateLimitStore?: MfaRateLimitStore;
}): Promise<DiscoverablePasskeyLoginOptions> {
  const store = ephemeralStore(input.store);
  const rateLimit = await enforceMfaChallengeCreationRateLimits({
    store: input.rateLimitStore,
    userId: `discoverable:${input.ip ?? 'unknown'}`,
    provider: 'credentials',
    ip: input.ip,
  });
  if (!rateLimit.allowed) throw new Error('PASSKEY_RATE_LIMITED');
  const config = getPasskeyConfig();
  const challengeId = randomUUID();
  const challenge = randomBytes(32).toString('base64url');
  const options = await generateAuthenticationOptions({
    rpID: config.rpId,
    challenge,
    timeout: 60_000,
    userVerification: 'required',
  });
  await store.set(
    discoverableLoginKey(challengeId),
    JSON.stringify({ challenge: (options as { challenge: string }).challenge }),
    PASSKEY_CHALLENGE_TTL_MS,
  );
  return { challengeId, options };
}

export async function createPasskeyRegistrationOptions(input: {
  userId: string;
  email: string;
  name?: string | null;
  ip?: string | null;
  store?: PasskeyEphemeralStore;
  rateLimitStore?: MfaRateLimitStore;
}): Promise<unknown> {
  const rateLimit = await enforceMfaRateLimits({
    store: input.rateLimitStore,
    userId: input.userId,
    provider: 'passkey',
    ip: input.ip,
    setup: true,
  });
  if (!rateLimit.allowed) throw new Error('PASSKEY_REGISTRATION_RATE_LIMITED');
  const config = getPasskeyConfig();
  const challenge = randomBytes(32).toString('base64url');
  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userID: input.userId,
    userName: input.email,
    userDisplayName: input.name?.trim() || input.email,
    challenge,
    timeout: 60_000,
    attestationType: 'none',
    excludeCredentials: listRows(input.userId).map((row) => ({
      id: decode(row.credential_id),
      type: 'public-key' as const,
      transports: parseCredentialData(row.credential_data).transports,
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  });
  await ephemeralStore(input.store).set(
    registrationKey(input.userId),
    JSON.stringify({ userId: input.userId, challenge: options.challenge }),
    PASSKEY_CHALLENGE_TTL_MS,
  );
  return options;
}

export async function verifyPasskeyRegistration(input: {
  userId: string;
  response: PasskeyRegistrationResponse;
  name?: string;
  store?: PasskeyEphemeralStore;
}): Promise<PasskeySummary> {
  const store = ephemeralStore(input.store);
  const raw = await store.get(registrationKey(input.userId));
  if (!raw) throw new Error('PASSKEY_REGISTRATION_EXPIRED');
  let state: { userId: string; challenge: string };
  try {
    state = JSON.parse(raw) as { userId: string; challenge: string };
  } catch {
    throw new Error('PASSKEY_REGISTRATION_INVALID');
  }
  if (state.userId !== input.userId || !state.challenge || !(await store.compareAndDelete(registrationKey(input.userId), raw))) {
    throw new Error('PASSKEY_REGISTRATION_INVALID');
  }

  const config = getPasskeyConfig();
  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: state.challenge,
      expectedOrigin: config.origins,
      expectedRPID: config.rpId,
      requireUserVerification: true,
    });
  } catch {
    throw new Error('PASSKEY_REGISTRATION_INVALID');
  }
  if (!verified.verified || !verified.registrationInfo) throw new Error('PASSKEY_REGISTRATION_INVALID');

  const info = verified.registrationInfo;
  const credentialId = encode(info.credentialID);
  const credentialData = JSON.stringify({
    publicKey: encode(info.credentialPublicKey),
    counter: info.counter,
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    transports: input.response.response.transports ?? [],
  } satisfies StoredCredentialData);
  const now = new Date().toISOString();
  return withDatabase((db) => {
    const existing = db.prepare('SELECT id FROM user_authenticators WHERE credential_id = ?').get(credentialId) as { id: string } | undefined;
    if (existing) throw new Error('PASSKEY_CREDENTIAL_EXISTS');
    const id = randomUUID();
    db.prepare(`
      INSERT INTO user_authenticators
        (id, user_id, type, name, credential_data, credential_id, required, enabled, created_at, updated_at)
      VALUES (?, ?, 'passkey', ?, ?, ?, 0, 1, ?, ?)
    `).run(id, input.userId, normalizeName(input.name), credentialData, credentialId, now, now);
    recordSecurityEvent(db, {
      userId: input.userId,
      eventType: 'PASSKEY_CREATED',
      metadata: { authenticatorId: id },
    });
    return { id, name: normalizeName(input.name), createdAt: now, lastUsedAt: null };
  });
}

export async function createPasskeyLoginOptions(input: {
  userId: string;
  challengeId: string;
  challengeToken: string;
  store?: PasskeyEphemeralStore;
}): Promise<unknown> {
  const challengeState = readOnlyDatabase((db) => db.prepare(`
    SELECT userId, expiresAt, consumedAt, attemptCount
    FROM MfaChallenge
    WHERE id = ? AND challengeHash = ? AND purpose = 'login'
  `).get(input.challengeId, hashChallengeForStorage(input.challengeToken)) as {
    userId: string;
    expiresAt: string;
    consumedAt: string | null;
    attemptCount: number;
  } | undefined);
  if (!challengeState || challengeState.userId !== input.userId || Date.parse(challengeState.expiresAt) <= Date.now()) {
    throw new Error('PASSKEY_LOGIN_EXPIRED');
  }
  if (challengeState.consumedAt || challengeState.attemptCount >= MFA_MAX_ATTEMPTS) {
    throw new Error('PASSKEY_LOGIN_LOCKED');
  }
  const rows = listRows(input.userId);
  if (rows.length === 0) throw new Error('PASSKEY_NOT_REGISTERED');
  const config = getPasskeyConfig();
  const challenge = randomBytes(32).toString('base64url');
  const options = await generateAuthenticationOptions({
    rpID: config.rpId,
    challenge,
    timeout: 60_000,
    userVerification: 'required',
    allowCredentials: rows.map((row) => ({
      id: decode(row.credential_id),
      type: 'public-key' as const,
      transports: parseCredentialData(row.credential_data).transports,
    })),
  });
  await ephemeralStore(input.store).set(
    loginKey(input.challengeId),
    JSON.stringify({ userId: input.userId, challenge: options.challenge }),
    PASSKEY_CHALLENGE_TTL_MS,
  );
  return options;
}

function recordPasskeyLoginFailure(
  userId: string | null,
  provider: MfaChallengeProvider,
  reason: string,
  ip?: string | null,
  challengeToken?: string,
): void {
  try {
    withDatabase((db) => {
      if (userId && challengeToken) {
        recordMfaFailure(db, { token: challengeToken, userId, purpose: 'login', provider });
      }
      recordSecurityEvent(db, {
        userId,
        eventType: 'PASSKEY_LOGIN_FAILED',
        ip,
        metadata: { provider, reason },
      });
    });
  } catch {
    // An audit event must not turn an already failed authentication into a 500.
  }
}

export async function verifyPasskeyLogin(input: {
  userId: string;
  provider: MfaChallengeProvider;
  challengeId: string;
  challengeToken: string;
  response: PasskeyAuthenticationResponse;
  ip?: string | null;
  store?: PasskeyEphemeralStore;
  rateLimitStore?: MfaRateLimitStore;
}): Promise<{ passkeyToken: string; login: PasskeyVerifiedLogin }> {
  const rateLimit = await enforceMfaRateLimits({
    store: input.rateLimitStore,
    userId: input.userId,
    provider: input.provider,
    ip: input.ip,
  });
  if (!rateLimit.allowed) {
    recordPasskeyLoginFailure(input.userId, input.provider, 'rate_limited', input.ip, input.challengeToken);
    throw new Error('PASSKEY_RATE_LIMITED');
  }
  const store = ephemeralStore(input.store);
  const raw = await store.get(loginKey(input.challengeId));
  if (!raw) {
    recordPasskeyLoginFailure(input.userId, input.provider, 'options_expired', input.ip, input.challengeToken);
    throw new Error('PASSKEY_LOGIN_EXPIRED');
  }
  let state: { userId: string; challenge: string };
  try {
    state = JSON.parse(raw) as { userId: string; challenge: string };
  } catch {
    throw new Error('PASSKEY_LOGIN_INVALID');
  }
  if (
    state.userId !== input.userId ||
    !state.challenge ||
    !(await store.compareAndDelete(loginKey(input.challengeId), raw)) ||
    !readMfaLoginChallengeContext(input.challengeId, input.challengeToken)
  ) {
    recordPasskeyLoginFailure(input.userId, input.provider, 'challenge_invalid', input.ip, input.challengeToken);
    throw new Error('PASSKEY_LOGIN_INVALID');
  }

  const credentialId = input.response.id;
  const challengeState = readOnlyDatabase((db) => db.prepare(`
    SELECT userId, provider, expiresAt, consumedAt, attemptCount
    FROM MfaChallenge
    WHERE id = ? AND challengeHash = ? AND purpose = 'login'
  `).get(input.challengeId, hashChallengeForStorage(input.challengeToken)) as {
    userId: string;
    provider: MfaChallengeProvider;
    expiresAt: string;
    consumedAt: string | null;
    attemptCount: number;
  } | undefined);
  if (!challengeState || challengeState.userId !== input.userId || challengeState.provider !== input.provider) {
    recordPasskeyLoginFailure(input.userId, input.provider, 'challenge_invalid', input.ip, input.challengeToken);
    throw new Error('PASSKEY_LOGIN_INVALID');
  }
  if (challengeState.attemptCount >= MFA_MAX_ATTEMPTS) throw new Error('PASSKEY_LOGIN_LOCKED');
  if (challengeState.consumedAt || Date.parse(challengeState.expiresAt) <= Date.now()) {
    recordPasskeyLoginFailure(input.userId, input.provider, 'challenge_expired', input.ip, input.challengeToken);
    throw new Error('PASSKEY_LOGIN_EXPIRED');
  }
  const row = readOnlyDatabase((db) => db.prepare(`
    SELECT id, user_id, credential_id, credential_data, name, created_at, last_used_at
    FROM user_authenticators
    WHERE user_id = ? AND type = 'passkey' AND enabled = 1 AND credential_id = ?
  `).get(input.userId, credentialId) as PasskeyRow | undefined);
  if (!row) {
    recordPasskeyLoginFailure(input.userId, input.provider, 'credential_not_found', input.ip, input.challengeToken);
    throw new Error('PASSKEY_CREDENTIAL_NOT_FOUND');
  }

  const config = getPasskeyConfig();
  let verified;
  let storedData: StoredCredentialData;
  try {
    storedData = parseCredentialData(row.credential_data);
    verified = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: state.challenge,
      expectedOrigin: config.origins,
      expectedRPID: config.rpId,
      authenticator: {
        credentialID: decode(row.credential_id),
        credentialPublicKey: decode(storedData.publicKey),
        counter: storedData.counter,
        transports: storedData.transports as Array<'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb'> | undefined,
      },
      requireUserVerification: true,
    });
  } catch {
    recordPasskeyLoginFailure(input.userId, input.provider, 'assertion_invalid', input.ip, input.challengeToken);
    throw new Error('PASSKEY_LOGIN_INVALID');
  }
  if (!verified.verified) {
    recordPasskeyLoginFailure(input.userId, input.provider, 'assertion_invalid', input.ip, input.challengeToken);
    throw new Error('PASSKEY_LOGIN_INVALID');
  }

  const newCounter = verified.authenticationInfo.newCounter;
  // Authenticators that always report counter 0 are valid syncable passkeys;
  // enforce monotonicity when a device supplies a non-zero counter.
  if (storedData.counter > 0 && newCounter <= storedData.counter) {
    recordPasskeyLoginFailure(input.userId, input.provider, 'counter_replay', input.ip, input.challengeToken);
    throw new Error('PASSKEY_COUNTER_REPLAY');
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const login = withDatabase((db) => {
    const run = db.transaction(() => {
      const challenge = db.prepare(`
        SELECT userId, provider, expiresAt, consumedAt, attemptCount
        FROM MfaChallenge
        WHERE id = ? AND challengeHash = ? AND purpose = 'login'
      `).get(input.challengeId, hashChallengeForStorage(input.challengeToken)) as {
        userId: string;
        provider: string;
        expiresAt: string;
        consumedAt: string | null;
        attemptCount: number;
      } | undefined;
      if (!challenge || challenge.userId !== input.userId || challenge.provider !== input.provider) {
        throw new Error('PASSKEY_LOGIN_INVALID');
      }
      if (challenge.attemptCount >= MFA_MAX_ATTEMPTS) throw new Error('PASSKEY_LOGIN_LOCKED');
      if (challenge.consumedAt || Date.parse(challenge.expiresAt) <= now.getTime()) throw new Error('PASSKEY_LOGIN_INVALID');

      const current = db.prepare(`
        SELECT credential_data FROM user_authenticators
        WHERE id = ? AND user_id = ? AND type = 'passkey' AND enabled = 1
      `).get(row.id, input.userId) as { credential_data: string } | undefined;
      if (!current) throw new Error('PASSKEY_CREDENTIAL_NOT_FOUND');
      const latest = parseCredentialData(current.credential_data);
      if (latest.counter > 0 && newCounter <= latest.counter) throw new Error('PASSKEY_COUNTER_REPLAY');
      const nextData = JSON.stringify({ ...latest, counter: Math.max(latest.counter, newCounter) } satisfies StoredCredentialData);
      db.prepare(`
        UPDATE user_authenticators
        SET credential_data = ?, last_used_at = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND type = 'passkey' AND enabled = 1
      `).run(nextData, nowIso, nowIso, row.id, input.userId);
      const consumed = db.prepare(`
        UPDATE MfaChallenge SET consumedAt = ?
        WHERE id = ? AND consumedAt IS NULL AND expiresAt > ? AND attemptCount < ?
      `).run(nowIso, input.challengeId, nowIso, MFA_MAX_ATTEMPTS);
      if (consumed.changes !== 1) throw new Error('PASSKEY_LOGIN_INVALID');
      const user = db.prepare('SELECT id, email, name FROM User WHERE id = ?').get(input.userId) as { id: string; email: string; name: string | null } | undefined;
      if (!user) throw new Error('USER_NOT_FOUND');
      recordSecurityEvent(db, {
        userId: user.id,
        eventType: 'PASSKEY_LOGIN_SUCCESS',
        ip: input.ip,
        metadata: { provider: input.provider, authenticatorId: row.id },
      });
      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        challengeId: input.challengeId,
        challengeTokenHash: hashChallengeForStorage(input.challengeToken),
        mfaVerifiedAt: now.getTime(),
      } satisfies PasskeyVerifiedLogin;
    });
    return run();
  });
  return { passkeyToken: await issuePasskeyVerifiedToken(login, input.store), login };
}

export async function verifyDiscoverablePasskeyLogin(input: {
  challengeId: string;
  response: PasskeyAuthenticationResponse;
  ip?: string | null;
  store?: PasskeyEphemeralStore;
  rateLimitStore?: MfaRateLimitStore;
}): Promise<{ challengeId: string; challengeToken: string; passkeyToken: string; login: PasskeyVerifiedLogin }> {
  const store = ephemeralStore(input.store);
  const raw = await store.get(discoverableLoginKey(input.challengeId));
  if (!raw) throw new Error('PASSKEY_LOGIN_EXPIRED');

  let state: { challenge: string };
  try {
    state = JSON.parse(raw) as { challenge: string };
  } catch {
    throw new Error('PASSKEY_LOGIN_INVALID');
  }
  if (!state.challenge || !(await store.compareAndDelete(discoverableLoginKey(input.challengeId), raw))) {
    throw new Error('PASSKEY_LOGIN_INVALID');
  }

  const row = readOnlyDatabase((db) => db.prepare(`
    SELECT id, user_id, credential_id, credential_data, name, created_at, last_used_at
    FROM user_authenticators
    WHERE type = 'passkey' AND enabled = 1 AND credential_id = ?
  `).get(input.response.id) as PasskeyRow | undefined);
  if (!row) throw new Error('PASSKEY_CREDENTIAL_NOT_FOUND');

  const rateLimit = await enforceMfaRateLimits({
    store: input.rateLimitStore,
    userId: row.user_id,
    provider: 'credentials',
    ip: input.ip,
  });
  if (!rateLimit.allowed) throw new Error('PASSKEY_RATE_LIMITED');

  let verified;
  let storedData: StoredCredentialData;
  try {
    const config = getPasskeyConfig();
    storedData = parseCredentialData(row.credential_data);
    verified = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: state.challenge,
      expectedOrigin: config.origins,
      expectedRPID: config.rpId,
      authenticator: {
        credentialID: decode(row.credential_id),
        credentialPublicKey: decode(storedData.publicKey),
        counter: storedData.counter,
        transports: storedData.transports as Array<'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb'> | undefined,
      },
      requireUserVerification: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const reason = message.includes('origin')
      ? 'origin'
      : message.includes('challenge')
        ? 'challenge'
        : message.includes('RPID') || message.includes('RP ID')
          ? 'rp_id'
          : message.includes('counter')
            ? 'counter'
            : message.includes('verification') || message.includes('verified')
              ? 'user_verification'
              : message.includes('signature')
                ? 'signature'
                : 'response';
    console.error('[passkey.login.discoverable.verify] assertion invalid:', reason);
    throw new Error('PASSKEY_LOGIN_INVALID');
  }
  if (!verified.verified) throw new Error('PASSKEY_LOGIN_INVALID');

  const newCounter = verified.authenticationInfo.newCounter;
  if (storedData.counter > 0 && newCounter <= storedData.counter) throw new Error('PASSKEY_COUNTER_REPLAY');

  const challenge = await createMfaLoginChallenge(row.user_id, 'credentials', input.ip);
  const nowIso = new Date().toISOString();
  const login = withDatabase((db) => {
    const run = db.transaction(() => {
      const current = db.prepare(`
        SELECT credential_data FROM user_authenticators
        WHERE id = ? AND user_id = ? AND type = 'passkey' AND enabled = 1
      `).get(row.id, row.user_id) as { credential_data: string } | undefined;
      if (!current) throw new Error('PASSKEY_CREDENTIAL_NOT_FOUND');
      const latest = parseCredentialData(current.credential_data);
      if (latest.counter > 0 && newCounter <= latest.counter) throw new Error('PASSKEY_COUNTER_REPLAY');
      const nextData = JSON.stringify({ ...latest, counter: Math.max(latest.counter, newCounter) } satisfies StoredCredentialData);
      db.prepare(`
        UPDATE user_authenticators
        SET credential_data = ?, last_used_at = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND type = 'passkey' AND enabled = 1
      `).run(nextData, nowIso, nowIso, row.id, row.user_id);
      const user = db.prepare('SELECT id, email, name FROM User WHERE id = ?').get(row.user_id) as { id: string; email: string; name: string | null } | undefined;
      if (!user) throw new Error('USER_NOT_FOUND');
      recordSecurityEvent(db, {
        userId: user.id,
        eventType: 'PASSKEY_LOGIN_SUCCESS',
        ip: input.ip,
        metadata: { provider: 'credentials', authenticatorId: row.id, discoverable: 'true' },
      });
      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        challengeId: challenge.id,
        challengeTokenHash: hashChallengeForStorage(challenge.token),
        mfaVerifiedAt: Date.now(),
      } satisfies PasskeyVerifiedLogin;
    });
    return run();
  });
  return {
    challengeId: challenge.id,
    challengeToken: challenge.token,
    passkeyToken: await issuePasskeyVerifiedToken(login, input.store),
    login,
  };
}

export function renamePasskey(userId: string, authenticatorId: string, name: string, ip?: string | null): PasskeySummary {
  const normalized = name.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80);
  if (!normalized) throw new Error('PASSKEY_NAME_INVALID');
  return withDatabase((db) => {
    const row = db.prepare(`
      SELECT id, name, created_at, last_used_at
      FROM user_authenticators
      WHERE id = ? AND user_id = ? AND type = 'passkey' AND enabled = 1
    `).get(authenticatorId, userId) as { id: string; name: string | null; created_at: string; last_used_at: string | null } | undefined;
    if (!row) throw new Error('PASSKEY_NOT_FOUND');
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE user_authenticators
      SET name = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND type = 'passkey' AND enabled = 1
    `).run(normalized, now, authenticatorId, userId);
    recordSecurityEvent(db, { userId, eventType: 'PASSKEY_RENAMED', ip, metadata: { authenticatorId } });
    return { id: row.id, name: normalized, createdAt: row.created_at, lastUsedAt: row.last_used_at };
  });
}

export function deletePasskey(userId: string, authenticatorId: string, ip?: string | null): void {
  withDatabase((db) => {
    const run = db.transaction(() => {
      const deleted = db.prepare(`
        DELETE FROM user_authenticators
        WHERE id = ? AND user_id = ? AND type = 'passkey' AND enabled = 1
          AND EXISTS (
            SELECT 1 FROM user_authenticators
            WHERE user_id = ? AND enabled = 1
              AND type IN ('totp', 'passkey', 'security_key')
              AND id != ?
          )
      `).run(authenticatorId, userId, userId, authenticatorId);
      if (deleted.changes !== 1) {
        const row = db.prepare(`
          SELECT id FROM user_authenticators
          WHERE id = ? AND user_id = ? AND type = 'passkey' AND enabled = 1
        `).get(authenticatorId, userId) as { id: string } | undefined;
        if (!row) throw new Error('PASSKEY_NOT_FOUND');
        throw new Error('LAST_AUTHENTICATOR');
      }
      recordSecurityEvent(db, { userId, eventType: 'PASSKEY_DELETED', ip, metadata: { authenticatorId } });
    });
    run();
  });
}
