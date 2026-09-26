import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import {
  createPendingOAuthLink,
  type PendingOAuthLink,
} from '@/lib/account-linking';
import { getTestDb, closeTestDb, clearAllTables, seedUserWithPassword } from './db-helpers';
import { storePendingRegistration } from '@/lib/pending-registration';

let pendingMerge: PendingOAuthLink | null = null;
const responseCookies = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = responseCookies.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => {
      responseCookies.set(name, value);
    },
    delete: (name: string) => {
      responseCookies.delete(name);
    },
  })),
}));

vi.mock('@/lib/account-linking', async () => {
  const actual = await vi.importActual<typeof import('@/lib/account-linking')>('@/lib/account-linking');
  return {
    ...actual,
    readPendingOAuthLinkCookie: vi.fn(async () => pendingMerge),
    clearPendingOAuthLinkCookie: vi.fn(async () => {
      pendingMerge = null;
    }),
  };
});

import { POST as mergePOST } from '@/app/api/account/merge/route';

function makeMergeReq(password: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/account/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

function setPendingMerge(targetUserId: string) {
  pendingMerge = createPendingOAuthLink(
    { provider: 'google', providerAccountId: 'google-sub-123' },
    'google',
    { mode: 'merge', targetUserId, oauthEmail: 'user@example.com' },
  );
}

describe('POST /api/account/merge', () => {
  beforeAll(() => {
    getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  beforeEach(async () => {
    pendingMerge = null;
    responseCookies.clear();
    clearAllTables(getTestDb());
    const hash = await bcrypt.hash('correct-password', 12);
    seedUserWithPassword(getTestDb(), {
      id: 'usr_merge',
      email: 'User@Example.com',
      passwordHash: hash,
    });
  });

  it('accepts the account password for case-insensitive email matches', async () => {
    setPendingMerge('usr_merge');

    const res = await mergePOST(makeMergeReq('correct-password'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.email).toBe('User@Example.com');
  });

  it('rejects an incorrect password', async () => {
    setPendingMerge('usr_merge');

    const res = await mergePOST(makeMergeReq('wrong-password'));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toMatch(/密码错误/);
  });

  it('rejects merge when stored password is not a bcrypt hash', async () => {
    getTestDb()
      .prepare('UPDATE User SET password = ? WHERE id = ?')
      .run('not-a-bcrypt-hash', 'usr_merge');
    setPendingMerge('usr_merge');

    const res = await mergePOST(makeMergeReq('correct-password'));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toMatch(/未设置密码/);
  });

  it('applies verified registration details after the password merge', async () => {
    setPendingMerge('usr_merge');
    const registrationToken = await storePendingRegistration('usr_merge', {
      name: '合并后姓名',
      phone: '13900000000',
      fullInstitution: '北京大学-医学部-基础医学系-科研楼B座-李教授实验室',
      school: '北京大学',
      college: '医学部',
      major: '基础医学系',
      building: '科研楼B座',
      piLab: '李教授实验室',
      affiliatedLab: '公共平台',
      acceptedLegalIds: ['site-privacy', 'site-terms'],
    });
    pendingMerge = { ...pendingMerge!, registrationToken };

    const res = await mergePOST(makeMergeReq('correct-password'));
    expect(res.status).toBe(200);

    const user = getTestDb().prepare(
      'SELECT name, phone, school, affiliatedLab, emailVerified FROM User WHERE id = ?',
    ).get('usr_merge') as {
      name: string;
      phone: string;
      school: string;
      affiliatedLab: string;
      emailVerified: string | null;
    };
    expect(user).toMatchObject({
      name: '合并后姓名',
      phone: '13900000000',
      school: '北京大学',
      affiliatedLab: '公共平台',
    });
    expect(user.emailVerified).toBeTruthy();
  });
});
