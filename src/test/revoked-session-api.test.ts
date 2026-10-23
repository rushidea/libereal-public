// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encode } from 'next-auth/jwt';
import { NextRequest } from 'next/server';
import { getTestDb, clearAllTables, closeTestDb, seedUser } from './db-helpers';

const authEnv = vi.hoisted(() => {
  process.env.AUTH_SECRET ||= 'revoked-session-integration-secret';
  return { secret: process.env.AUTH_SECRET ?? 'revoked-session-integration-secret' };
});

const headerState = vi.hoisted(() => ({
  current: new Headers({
    host: 'localhost:3000',
    'x-forwarded-proto': 'http',
  }),
}));

vi.mock('next/headers', () => ({
  headers: async () => headerState.current,
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    set: () => undefined,
    delete: () => undefined,
  }),
}));

import { POST as redeemPOST } from '@/app/api/points/redeem/route';
import { GET as profileGET } from '@/app/api/profile/route';
import { GET as addressesGET } from '@/app/api/addresses/route';

const USER_ID = 'u-revoked';
const USER_EMAIL = 'revoked@test.com';
const SESSION_ID = 'issued-session';
const SESSION_COOKIE = 'authjs.session-token';
const SECRET_PHONE = '13800138000';
const SECRET_INSTITUTION = 'Revoked Institute Lab';
const SECRET_ADDRESS = 'Revoked Street 88';

function seedActiveSession() {
  const db = getTestDb();
  seedUser(db, {
    id: USER_ID,
    email: USER_EMAIL,
    name: 'Revoked User',
    points: 1000,
    phone: SECRET_PHONE,
    institution: SECRET_INSTITUTION,
  });
  db.prepare(`
    INSERT INTO user_sessions (id, user_id, session_id, created_at, last_seen_at, expires_at, revoked_at)
    VALUES ('us-issued', ?, ?, datetime('now'), datetime('now'), datetime('now', '+7 days'), NULL)
  `).run(USER_ID, SESSION_ID);
  db.prepare(`
    INSERT INTO PointsProduct (id, name, pointsCost, stock, category, isActive, createdAt, updatedAt)
    VALUES ('prod-virtual', 'Virtual kit', 100, 5, 'virtual', 1, datetime('now'), datetime('now'))
  `).run();
  db.prepare(`
    INSERT INTO Address (id, userId, name, phone, address, isDefault, createdAt, updatedAt)
    VALUES ('addr-1', ?, 'Receiver', ?, ?, 1, datetime('now'), datetime('now'))
  `).run(USER_ID, SECRET_PHONE, SECRET_ADDRESS);
}

async function issueSessionCookie() {
  const jwt = await encode({
    secret: authEnv.secret,
    salt: SESSION_COOKIE,
    token: {
      id: USER_ID,
      sub: USER_ID,
      email: USER_EMAIL,
      name: 'Revoked User',
      sessionId: SESSION_ID,
      authLevel: 'primary_verified',
    },
  });
  headerState.current = new Headers({
    host: 'localhost:3000',
    'x-forwarded-proto': 'http',
    cookie: `${SESSION_COOKIE}=${jwt}`,
  });
  return jwt;
}

function clearSessionCookie() {
  headerState.current = new Headers({
    host: 'localhost:3000',
    'x-forwarded-proto': 'http',
  });
}

function profileRequest(): NextRequest {
  const cookie = headerState.current.get('cookie');
  return new NextRequest('http://localhost:3000/api/profile', {
    headers: cookie ? { cookie } : {},
  });
}

function addressRequest(): NextRequest {
  const cookie = headerState.current.get('cookie');
  return new NextRequest('http://localhost:3000/api/addresses', {
    headers: cookie ? { cookie } : {},
  });
}

function redeemRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/points/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: 'prod-virtual' }),
  });
}

describe('revoked server sessions on auth()-only APIs', () => {
  beforeAll(() => {
    getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  beforeEach(async () => {
    clearAllTables(getTestDb());
    seedActiveSession();
    await issueSessionCookie();
  });

  it('accepts a real JWT while its server session is active', async () => {
    const profile = await profileGET(profileRequest());
    const profileBody = await profile.json();
    expect(profile.status).toBe(200);
    expect(profileBody.profile.phone).toBe(SECRET_PHONE);
    expect(profileBody.profile.institution).toBe(SECRET_INSTITUTION);

    const addresses = await addressesGET(addressRequest());
    const addressBody = await addresses.json();
    expect(addresses.status).toBe(200);
    expect(addressBody).toEqual([
      expect.objectContaining({ id: 'addr-1', address: SECRET_ADDRESS }),
    ]);

    const redeem = await redeemPOST(redeemRequest());
    const redeemBody = await redeem.json();
    expect(redeem.status).toBe(200);
    expect(redeemBody.success).toBe(true);
    expect(redeemBody.newPoints).toBe(900);
  });

  it('rejects redeem, profile, and address reads after that session is revoked', async () => {
    getTestDb().prepare(`UPDATE user_sessions SET revoked_at = datetime('now') WHERE session_id = ?`).run(SESSION_ID);

    const redeem = await redeemPOST(redeemRequest());
    expect(redeem.status).toBe(401);
    const points = getTestDb().prepare('SELECT points FROM User WHERE id = ?').get(USER_ID) as { points: number };
    expect(points.points).toBe(1000);
    const redemptions = getTestDb().prepare('SELECT id FROM PointsRedemption').all();
    expect(redemptions).toHaveLength(0);

    const profile = await profileGET(profileRequest());
    const profileText = JSON.stringify(await profile.json());
    expect(profile.status).toBe(401);
    expect(profileText).not.toContain(SECRET_PHONE);
    expect(profileText).not.toContain(SECRET_INSTITUTION);

    const addresses = await addressesGET(addressRequest());
    const addressText = JSON.stringify(await addresses.json());
    expect(addresses.status).toBe(401);
    expect(addressText).not.toContain(SECRET_ADDRESS);
  });

  it('keeps anonymous profile reads empty when no session cookie is presented', async () => {
    clearSessionCookie();
    const profile = await profileGET(profileRequest());
    expect(profile.status).toBe(200);
    expect(await profile.json()).toEqual({ profile: null });
  });
});
