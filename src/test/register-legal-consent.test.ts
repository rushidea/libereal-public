import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { clearAllTables, getTestDb } from './db-helpers';

vi.mock('@/lib/legal-documents', () => ({
  getRequiredLegalDocumentIds: vi.fn().mockResolvedValue(['site-privacy', 'site-terms']),
  getRequiredLegalConsent: vi.fn().mockResolvedValue({
    requiredIds: ['site-privacy', 'site-terms'],
    snapshot: {
      acceptedAt: '2026-07-17T00:00:00.000Z',
      documents: [
        { id: 'site-privacy', version: '2025-01-01' },
        { id: 'site-terms', version: '2026-07-17' },
      ],
    },
  }),
  getRequiredLegalDocumentSnapshot: vi.fn().mockResolvedValue({
    acceptedAt: '2026-07-17T00:00:00.000Z',
    documents: [
      { id: 'site-privacy', version: '2025-01-01' },
      { id: 'site-terms', version: '2026-07-17' },
    ],
  }),
  validateAcceptedLegalIds: vi.fn((accepted: unknown, required: string[]) => {
    const values = Array.isArray(accepted) ? accepted : [];
    const missing = required.filter((id) => !values.includes(id));
    return { ok: missing.length === 0, missing };
  }),
}));

import { POST } from '@/app/api/auth/register/route';

describe('register route legal consent', () => {
  beforeEach(() => {
    clearAllTables(getTestDb());
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '1x0000000000000000000000000000000AA');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '1x0000000000000000000000000000000AA');
  });

  it('rejects registration without required legal acceptance', async () => {
    const req = new NextRequest('http://localhost/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test',
        email: 'test@example.com',
        emailCode: '123456',
        phone: '13800000000',
        smsCode: '123456',
        password: 'Password1!',
        school: '清华大学',
        college: '生命科学学院',
        major: '生物系',
        building: '医学楼A座',
        piLab: '张教授实验室',
        acceptedLegalIds: ['site-privacy'],
        turnstileToken: 'test-token',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/协议/);
  });
});
