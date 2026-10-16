import { createHash } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';

const sessionMock = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  consumeSecurityStepUpGrant: vi.fn(async () => true),
  sendMail: vi.fn(async () => ({ ok: true, provider: 'console' as const })),
}));

vi.mock('@/lib/session', () => ({
  requireActiveSession: sessionMock.requireActiveSession,
}));
vi.mock('@/lib/security/security-step-up', () => ({
  consumeSecurityStepUpGrant: sessionMock.consumeSecurityStepUpGrant,
}));
vi.mock('@/lib/mail', () => ({
  sendMail: sessionMock.sendMail,
}));

import { POST as setPassword } from '@/app/api/account/set-password/route';
import { POST as sendEmailCode } from '@/app/api/account/email/send/route';
import { POST as confirmEmail } from '@/app/api/account/email/confirm/route';

const placeholderId = 'user-placeholder';
const placeholderEmail = 'wechat_abc@wechat.local';

function asUser(id: string, email: string) {
  sessionMock.requireActiveSession.mockResolvedValue({
    id,
    email,
    role: 'customer',
    sessionId: 'session-1',
  });
}

function post(url: string, body: object) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function accountToken(email: string, code: string) {
  const identifier = `account-email:${email}`;
  const token = createHash('sha256').update(`${identifier}:${code}`).digest('hex');
  return { identifier, token };
}

function insertAccountCode(email: string, code: string) {
  const { identifier, token } = accountToken(email, code);
  getTestDb().prepare(
    'INSERT INTO VerificationToken (identifier, token, expires) VALUES (?, ?, ?)',
  ).run(identifier, token, new Date(Date.now() + 60_000).toISOString());
}

function insertUser(id: string, email: string, emailVerified: string | null = null) {
  getTestDb().prepare(`
    INSERT INTO User (id, name, email, role, emailVerified, createdAt, updatedAt)
    VALUES (?, ?, ?, 'customer', ?, datetime('now'), datetime('now'))
  `).run(id, '测试用户', email, emailVerified);
}

describe('account email ownership', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    clearAllTables(getTestDb());
    sessionMock.consumeSecurityStepUpGrant.mockReset();
    sessionMock.consumeSecurityStepUpGrant.mockResolvedValue(true);
    sessionMock.sendMail.mockClear();
    asUser(placeholderId, placeholderEmail);
    insertUser(placeholderId, placeholderEmail);
  });

  it('sends an ownership code to a deliverable replacement mailbox', async () => {
    const response = await sendEmailCode(post('http://localhost/api/account/email/send', {
      email: 'new@example.com',
    }));
    expect(response.status).toBe(200);
    const calls = sessionMock.sendMail.mock.calls as unknown as Array<[{ to: string; subject: string }]>;
    const message = calls[0]?.[0];
    expect(message?.to).toBe('new@example.com');
    expect(message?.subject).toBe('LIBEREAL · 绑定邮箱验证码');

    const placeholderTarget = await sendEmailCode(post('http://localhost/api/account/email/send', {
      email: 'foo@wechat.local',
    }));
    expect(placeholderTarget.status).toBe(400);
  });

  it('does not change a placeholder email without a verification code', async () => {
    const response = await setPassword(post('http://localhost/api/account/set-password', {
      email: 'victim@example.com',
      password: 'password123',
      confirmPassword: 'password123',
      stepUpToken: 'grant-1',
    }));

    expect(response.status).toBe(400);
    const row = getTestDb().prepare('SELECT email, password, emailVerified FROM User WHERE id = ?').get(placeholderId) as {
      email: string;
      password: string | null;
      emailVerified: string | null;
    };
    expect(row).toEqual({ email: placeholderEmail, password: null, emailVerified: null });
    expect(sessionMock.consumeSecurityStepUpGrant).not.toHaveBeenCalled();
  });

  it('rejects a registration code and leaves the placeholder email in place', async () => {
    const email = 'victim@example.com';
    const code = '654321';
    const identifier = `registration-email:${email}`;
    const token = createHash('sha256').update(`${identifier}:${code}`).digest('hex');
    getTestDb().prepare(
      'INSERT INTO VerificationToken (identifier, token, expires) VALUES (?, ?, ?)',
    ).run(identifier, token, new Date(Date.now() + 60_000).toISOString());

    const response = await setPassword(post('http://localhost/api/account/set-password', {
      email,
      emailCode: code,
      password: 'password123',
      confirmPassword: 'password123',
      stepUpToken: 'grant-1',
    }));

    expect(response.status).toBe(400);
    const row = getTestDb().prepare('SELECT email, password FROM User WHERE id = ?').get(placeholderId) as { email: string; password: string | null };
    expect(row).toEqual({ email: placeholderEmail, password: null });
    expect(getTestDb().prepare('SELECT token FROM VerificationToken WHERE identifier = ?').get(identifier)).toBeTruthy();
  });

  it('sets the email only after the ownership code is consumed', async () => {
    const email = 'owner@example.com';
    const code = '123456';
    insertAccountCode(email, code);

    const response = await setPassword(post('http://localhost/api/account/set-password', {
      email: ' Owner@Example.com ',
      emailCode: code,
      password: 'password123',
      confirmPassword: 'password123',
      stepUpToken: 'grant-1',
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.email).toBe(email);
    const row = getTestDb().prepare('SELECT email, password, emailVerified FROM User WHERE id = ?').get(placeholderId) as {
      email: string;
      password: string | null;
      emailVerified: string | null;
    };
    expect(row.email).toBe(email);
    expect(row.password).toBeTruthy();
    expect(row.emailVerified).toBeTruthy();
    expect(getTestDb().prepare('SELECT token FROM VerificationToken WHERE identifier = ?').get(`account-email:${email}`)).toBeUndefined();
  });

  it('does not take an email that already belongs to another account', async () => {
    insertUser('other-user', 'Victim@Example.com');
    insertAccountCode('victim@example.com', '123456');

    const sent = await sendEmailCode(post('http://localhost/api/account/email/send', {
      email: 'victim@example.com',
    }));
    expect(sent.status).toBe(409);
    expect(sessionMock.sendMail).not.toHaveBeenCalled();

    const response = await setPassword(post('http://localhost/api/account/set-password', {
      email: 'victim@example.com',
      emailCode: '123456',
      password: 'password123',
      confirmPassword: 'password123',
      stepUpToken: 'grant-1',
    }));

    expect(response.status).toBe(409);
    const row = getTestDb().prepare('SELECT email FROM User WHERE id = ?').get(placeholderId) as { email: string };
    expect(row.email).toBe(placeholderEmail);
    expect(sessionMock.consumeSecurityStepUpGrant).not.toHaveBeenCalled();
  });

  it('verifies an already saved deliverable email without changing it', async () => {
    const email = 'saved@example.com';
    insertUser('saved-user', email);
    asUser('saved-user', email);
    insertAccountCode(email, '112233');

    const sent = await sendEmailCode(post('http://localhost/api/account/email/send', { email: 'other@example.com' }));
    expect(sent.status).toBe(400);
    expect(sessionMock.sendMail).not.toHaveBeenCalled();

    const confirmed = await confirmEmail(post('http://localhost/api/account/email/confirm', { emailCode: '112233' }));
    expect(confirmed.status).toBe(200);
    const row = getTestDb().prepare('SELECT email, emailVerified FROM User WHERE id = ?').get('saved-user') as {
      email: string;
      emailVerified: string | null;
    };
    expect(row.email).toBe(email);
    expect(row.emailVerified).toBeTruthy();
  });
});
