import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';

const mocks = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  requireActiveSession: mocks.requireActiveSession,
  requireAdmin: mocks.requireAdmin,
}));

import { GET as inquiryDetailGET } from '@/app/api/inquiries/[id]/route';

function seedInquiry(userId: string) {
  getTestDb().prepare(`
    INSERT INTO Inquiry (
      id, userId, name, email, phone, institution, owner_scope, subtotal, status, operationLogs, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, 'personal', 0, 'pending_quote', '[]', datetime('now'))
  `).run('inq_detail', userId, '购买人', 'buyer@test.com', '13800000000', '测试单位');
}

describe('GET /api/inquiries/[id] creator id', () => {
  beforeAll(() => {
    getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  beforeEach(() => {
    clearAllTables(getTestDb());
    seedInquiry('creator-secret-user');
    mocks.requireActiveSession.mockReset();
    mocks.requireAdmin.mockReset();
  });

  async function getDetail() {
    return inquiryDetailGET(
      new NextRequest('http://localhost:3000/api/inquiries/inq_detail'),
      { params: Promise.resolve({ id: 'inq_detail' }) },
    );
  }

  it('does not return the creator user id to someone who can view the inquiry', async () => {
    mocks.requireActiveSession.mockResolvedValue({
      id: 'viewer',
      email: 'buyer@test.com',
      role: 'customer',
      sessionId: 'session-1',
    });

    const response = await getDetail();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('inq_detail');
    expect(body.email).toBe('buyer@test.com');
    expect(body).not.toHaveProperty('userId');
    expect(JSON.stringify(body)).not.toContain('creator-secret-user');
  });

  it('does not return the creator user id on the admin detail response', async () => {
    mocks.requireActiveSession.mockResolvedValue({
      id: 'admin',
      email: 'admin@test.com',
      role: 'admin',
      sessionId: 'session-1',
    });
    mocks.requireAdmin.mockResolvedValue({
      id: 'admin',
      email: 'admin@test.com',
      role: 'admin',
      sessionId: 'session-1',
    });

    const response = await getDetail();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty('userId');
    expect(JSON.stringify(body)).not.toContain('creator-secret-user');
  });

  it('does not include the creator user id when access is denied', async () => {
    mocks.requireActiveSession.mockResolvedValue({
      id: 'other',
      email: 'other@test.com',
      role: 'customer',
      sessionId: 'session-1',
    });

    const response = await getDetail();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
    expect(body).not.toHaveProperty('userId');
  });

  it('still rejects a missing session before reading the inquiry', async () => {
    mocks.requireActiveSession.mockResolvedValue(
      NextResponse.json({ error: '未登录' }, { status: 401 }),
    );

    const response = await getDetail();
    expect(response.status).toBe(401);
  });
});
