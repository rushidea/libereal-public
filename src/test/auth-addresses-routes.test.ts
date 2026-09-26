import { describe, it, expect, beforeAll, beforeEach, vi, afterAll, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';

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

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'u1', email: 'u1@test.com', name: 'U1', role: 'customer', sessionId: 'session-1' },
  }),
}));

vi.mock('@/lib/account-linking', async () => {
  const actual = await vi.importActual<typeof import('@/lib/account-linking')>('@/lib/account-linking');
  return {
    ...actual,
    readPendingOAuthLinkCookie: vi.fn(async () => null),
    setPendingOAuthLinkCookie: vi.fn(async () => undefined),
    clearPendingOAuthLinkCookie: vi.fn(async () => undefined),
  };
});

vi.mock('@/lib/legal-documents', () => ({
  getRequiredLegalDocumentIds: vi.fn(async () => ['site-privacy', 'site-terms']),
  getRequiredLegalConsent: vi.fn(async () => ({
    requiredIds: ['site-privacy', 'site-terms'],
    snapshot: {
      acceptedAt: '2026-07-17T00:00:00.000Z',
      documents: [
        { id: 'site-privacy', version: '2025-01-01' },
        { id: 'site-terms', version: '2026-07-17' },
      ],
    },
  })),
  getRequiredLegalDocumentSnapshot: vi.fn(async () => ({
    acceptedAt: '2026-07-17T00:00:00.000Z',
    documents: [
      { id: 'site-privacy', version: '2025-01-01' },
      { id: 'site-terms', version: '2026-07-17' },
    ],
  })),
  validateAcceptedLegalIds: vi.fn((accepted: unknown, required: string[]) => {
    const values = Array.isArray(accepted) ? accepted : [];
    const missing = required.filter((id) => !values.includes(id));
    return { ok: missing.length === 0, missing };
  }),
  ensureLegalDocumentsSeeded: vi.fn(async () => undefined),
  listLegalDocuments: vi.fn(async () => []),
  resolveLegalPdfAbsolutePath: vi.fn(async () => null),
  getLegalDocumentContent: vi.fn(async () => null),
  getLegalDocumentPublicView: vi.fn(async () => null),
}));

vi.mock('@/lib/sms-verification', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sms-verification')>('@/lib/sms-verification');
  return {
    ...actual,
    verifySmsCode: vi.fn(async () => true),
  };
});

vi.mock('@/lib/email-verification', () => ({
  consumeRegistrationEmailCode: vi.fn(async () => true),
}));

import { POST as registerPOST } from '@/app/api/auth/register/route';
import { GET as roleGET } from '@/app/api/auth/role/route';
import { GET as addressesGET, POST as addressesPOST } from '@/app/api/addresses/route';
import { NextRequest } from 'next/server';
import { MERGE_VERIFIED_COOKIE } from '@/lib/auth-helpers';
import { readPendingOAuthLinkCookie } from '@/lib/account-linking';
import { getTestDb, closeTestDb, seedUser, seedUserWithPassword, clearAllTables } from './db-helpers';

function makeReq(url: string, body: object): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function registerBody(overrides: Record<string, unknown> = {}) {
  return {
    name: '新用户',
    email: 'new@test.com',
    emailCode: '123456',
    phone: '13800000000',
    smsCode: '123456',
    password: 'password123',
    school: '清华大学',
    college: '生命科学学院',
    major: '生物系',
    building: '医学楼A座',
    piLab: '张教授实验室',
    acceptedLegalIds: ['site-privacy', 'site-terms'],
    ...overrides,
  };
}

describe('POST /api/auth/register', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  afterEach(() => { vi.unstubAllEnvs(); });
  beforeEach(() => {
    responseCookies.clear();
    const db = getTestDb();
    clearAllTables(db);
  });

  it('creates new user with hashed password + default tier=standard + admin notification', async () => {
    const res = await registerPOST(makeReq('http://localhost:3000/api/auth/register', registerBody({
      institution: '清华',
    })) as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.email).toBe('new@test.com');
    expect(json.name).toBe('新用户');
    expect(json.id).toMatch(/^usr_/);

    const db = getTestDb();
    const u = db.prepare('SELECT * FROM User WHERE id = ?').get(json.id) as { email: string; phone: string; tier: string; role: string; password: string; emailVerified: string | null };
    expect(u.email).toBe('new@test.com');
    expect(u.phone).toBe('13800000000');
    expect(u.tier).toBe('standard');
    expect(u.role).toBe('customer');
    expect(u.emailVerified).toBeTruthy();
    // password 应被 bcrypt 哈希 (不是明文)
    expect(u.password).not.toBe('password123');
    expect(u.password.length).toBeGreaterThan(20); // bcrypt hash

    // admin notification
    const notifs = db.prepare("SELECT * FROM Notification WHERE email = 'admin'").all() as Array<{ type: string; title: string }>;
    expect(notifs).toHaveLength(1);
    expect(notifs[0].title).toMatch(/新用户/);
  });

  it('stores hospital hierarchy in the generic institution profile fields', async () => {
    const res = await registerPOST(makeReq('http://localhost:3000/api/auth/register', registerBody({
      email: 'hospital@test.com',
      institutionType: '医院',
      institutionName: '某某医院',
      institutionUnit: '东院区',
      institutionDepartment: '血液科',
      institutionFacility: '研究中心',
      piLab: '王医生课题组',
      affiliatedLab: '临床检验平台',
      school: '',
      college: '',
      major: '',
      building: '',
    })) as NextRequest);
    expect(res.status).toBe(201);

    const user = getTestDb().prepare(
      'SELECT institutionType, institutionName, institutionUnit, department, institutionFacility, school, piLab, affiliatedLab FROM User WHERE email = ?',
    ).get('hospital@test.com') as Record<string, string | null>;
    expect(user).toMatchObject({
      institutionType: '医院',
      institutionName: '某某医院',
      institutionUnit: '东院区',
      department: '血液科',
      institutionFacility: '研究中心',
      school: null,
      piLab: '王医生课题组',
      affiliatedLab: '临床检验平台',
    });
  });

  it('sets merge-verified cookie for immediate post-registration signIn', async () => {
    const res = await registerPOST(makeReq('http://localhost:3000/api/auth/register', registerBody()) as NextRequest);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(responseCookies.get(MERGE_VERIFIED_COOKIE)).toBe(json.id);
  });

  it('returns 409 for duplicate email (case-insensitive)', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'existing', email: 'User@Example.com' });

    const res = await registerPOST(makeReq('http://localhost:3000/api/auth/register', registerBody({
      name: 'X',
      email: 'user@example.com',
    })) as NextRequest);
    expect(res.status).toBe(409);
  });

  it('returns 409 for duplicate email exact match', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'existing', email: 'dupe@test.com' });

    const res = await registerPOST(makeReq('http://localhost:3000/api/auth/register', registerBody({
      name: 'X',
      email: 'dupe@test.com',
    })) as NextRequest);
    expect(res.status).toBe(409);
  });

  it('merges pending WeChat registration into existing account and updates registration profile', async () => {
    const db = getTestDb();
    seedUserWithPassword(db, {
      id: 'existing',
      email: 'existing@test.com',
      name: '旧姓名',
      passwordHash: bcrypt.hashSync('password123', 10),
    });

    vi.mocked(readPendingOAuthLinkCookie).mockResolvedValueOnce({
      provider: 'wechat',
      providerAccountId: 'wx_union_1',
      type: 'oauth',
      mode: 'register',
      oauthName: '微信昵称',
      oauthImage: 'https://example.com/avatar.jpg',
      exp: Date.now() + 60000,
    });

    const res = await registerPOST(makeReq('http://localhost:3000/api/auth/register', registerBody({
      name: '合并后姓名',
      email: 'existing@test.com',
      phone: '13900000000',
      school: '北京大学',
      college: '医学部',
      major: '基础医学系',
      building: '科研楼B座',
      piLab: '李教授实验室',
      affiliatedLab: '公共平台',
    })) as NextRequest);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.merged).toBe(true);
    expect(json.email).toBe('existing@test.com');

    const account = db.prepare('SELECT userId, provider, providerAccountId FROM Account WHERE provider = ?').get('wechat') as {
      userId: string;
      provider: string;
      providerAccountId: string;
    };
    expect(account).toEqual({
      userId: 'existing',
      provider: 'wechat',
      providerAccountId: 'wx_union_1',
    });

    const user = db.prepare(`
      SELECT name, phone, institution, school, college, major, building, piLab, affiliatedLab, wechatNickname, displayAvatarUrl
      FROM User WHERE id = ?
    `).get('existing') as {
      name: string;
      phone: string;
      institution: string;
      school: string;
      college: string;
      major: string;
      building: string;
      piLab: string;
      affiliatedLab: string;
      wechatNickname: string;
      displayAvatarUrl: string;
    };

    expect(user.name).toBe('合并后姓名');
    expect(user.phone).toBe('13900000000');
    expect(user.institution).toBe('北京大学-医学部-基础医学系-科研楼B座-李教授实验室');
    expect(user.school).toBe('北京大学');
    expect(user.college).toBe('医学部');
    expect(user.major).toBe('基础医学系');
    expect(user.building).toBe('科研楼B座');
    expect(user.piLab).toBe('李教授实验室');
    expect(user.affiliatedLab).toBe('公共平台');
    expect(user.wechatNickname).toBe('微信昵称');
    expect(user.displayAvatarUrl).toBe('https://example.com/avatar.jpg');
    expect(responseCookies.get(MERGE_VERIFIED_COOKIE)).toBe('existing');
  });

  it('returns 400 for password < 8 chars', async () => {
    const res = await registerPOST(makeReq('http://localhost:3000/api/auth/register', registerBody({
      name: 'X',
      email: 'x@test.com',
      password: 'short',
    })) as NextRequest);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/8/);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await registerPOST(makeReq('http://localhost:3000/api/auth/register', {
      email: 'x@test.com',
      // missing name + password
    }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('returns 403 when Turnstile token is missing with configured real keys', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'real-site-key');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'real-secret-key');

    const res = await registerPOST(makeReq('http://localhost:3000/api/auth/register', registerBody({
      name: 'Bot',
      email: 'bot@test.com',
    })) as NextRequest);

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/人机验证/);
  });
});

describe('GET /api/auth/role', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
  });

  it('returns customer role by default for unauthenticated', async () => {
    const { auth } = await import('@/lib/auth');
    (auth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await roleGET();
    const json = await res.json();
    expect(json.role).toBe('customer');
  });

  it('returns role from DB for authenticated user', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'u1', email: 'u1@test.com', role: 'customer' });
    db.prepare('UPDATE User SET role = ? WHERE id = ?').run('admin', 'u1');

    const res = await roleGET();
    const json = await res.json();
    expect(json.role).toBe('admin');
  });

  it('returns customer fallback for non-existent email', async () => {
    // auth mock returns u1, but no u1 in DB
    const res = await roleGET();
    const json = await res.json();
    expect(json.role).toBe('customer');
  });
});

describe('GET/POST /api/addresses', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedUser(db, { id: 'u1', email: 'u1@test.com' });
    seedUser(db, { id: 'u2', email: 'u2@test.com' });
  });

  it('GET returns empty array for user with no addresses', async () => {
    const res = await addressesGET(new NextRequest('http://localhost:3000/api/addresses') as NextRequest);
    const arr = await res.json();
    expect(res.status).toBe(200);
    expect(arr).toEqual([]);
  });

  it('GET returns user addresses, default first', async () => {
    const db = getTestDb();
    db.prepare(`INSERT INTO Address (id, userId, name, phone, address, isDefault, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`).run('a1', 'u1', '张三', '138', '北京', 0);
    db.prepare(`INSERT INTO Address (id, userId, name, phone, address, isDefault, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`).run('a2', 'u1', '李四', '139', '上海', 1);
    db.prepare(`INSERT INTO Address (id, userId, name, phone, address, isDefault, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`).run('a3', 'u2', '王五', '137', '广州', 1);

    const res = await addressesGET(new NextRequest('http://localhost:3000/api/addresses') as NextRequest);
    const arr = await res.json();
    expect(arr).toHaveLength(2);
    // u1 的地址，a2 (default) 在前
    expect(arr[0].id).toBe('a2');
    expect(arr[1].id).toBe('a1');
  });

  it('POST creates new address, returns 201', async () => {
    const res = await addressesPOST(makeReq('http://localhost:3000/api/addresses', {
      name: '收货人',
      phone: '13800001111',
      address: '北京市海淀区',
      institution: '清华',
    }) as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.name).toBe('收货人');
    expect(json.userId).toBe('u1');
    expect(json.isDefault).toBe(false);
  });

  it('POST with isDefault=true clears existing defaults first', async () => {
    const db = getTestDb();
    db.prepare(`INSERT INTO Address (id, userId, name, phone, address, isDefault, createdAt, updatedAt) VALUES ('a1', 'u1', 'X', '1', 'Y', 1, datetime('now'), datetime('now'))`).run();

    const res = await addressesPOST(makeReq('http://localhost:3000/api/addresses', {
      name: '新默认',
      phone: '2',
      address: 'Z',
      isDefault: true,
    }) as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.isDefault).toBe(true);

    // 老地址 isDefault 应清空
    const a1 = db.prepare('SELECT isDefault FROM Address WHERE id = ?').get('a1') as { isDefault: number };
    expect(a1.isDefault).toBe(0);
  });

  it('POST returns 400 for missing required fields', async () => {
    const res = await addressesPOST(makeReq('http://localhost:3000/api/addresses', {
      name: 'X',
      // missing phone + address
    }) as NextRequest);
    expect(res.status).toBe(400);
  });
});
