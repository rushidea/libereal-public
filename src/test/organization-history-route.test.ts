import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  requireOrganizationPermission: vi.fn(),
  hasOrganizationPermission: vi.fn(() => true),
  organizationRbacErrorStatus: vi.fn(() => 403),
  orderFindMany: vi.fn(),
  inquiryFindMany: vi.fn(),
  OrganizationRbacError: class OrganizationRbacError extends Error {
    code: string;
    constructor(code: string, message = code) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock('@/lib/session', () => ({ requireActiveSession: mocks.requireActiveSession }));
vi.mock('@/lib/organization-service', () => ({
  OrganizationRbacError: mocks.OrganizationRbacError,
  requireOrganizationPermission: mocks.requireOrganizationPermission,
  hasOrganizationPermission: mocks.hasOrganizationPermission,
  organizationRbacErrorStatus: mocks.organizationRbacErrorStatus,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    order: { findMany: mocks.orderFindMany },
    inquiry: { findMany: mocks.inquiryFindMany },
  },
}));

import { GET } from '@/app/api/organizations/[id]/history/route';

describe('organization history route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveSession.mockResolvedValue({ id: 'owner-1', email: 'owner@test.com', role: 'customer' });
    mocks.requireOrganizationPermission.mockResolvedValue({ organization: { name: '原组织' } });
    mocks.orderFindMany.mockResolvedValue([
      {
        id: 'order-1',
        status: 'completed',
        subtotal: 100,
        adjustmentTotal: 0,
        total: 100,
        paymentMethod: 'bank_transfer',
        createdAt: new Date('2026-08-01T00:00:00Z'),
        updatedAt: new Date('2026-08-01T00:00:00Z'),
        archivedAt: null,
        receivable: { id: 'receivable-1', amount: 100, status: 'paid', dueAt: null, paidAt: new Date('2026-08-02T00:00:00Z') },
      },
    ]);
    mocks.inquiryFindMany.mockResolvedValue([
      { id: 'inquiry-1', status: 'closed', subtotal: 100, createdAt: new Date('2026-08-01T00:00:00Z'), archivedAt: null },
    ]);
  });

  it('allows the original owner or authorized administrator to read organization-owned history only', async () => {
    const response = await GET(new Request('http://localhost/api/organizations/org-1/history'), { params: Promise.resolve({ id: 'org-1' }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      organization: { id: 'org-1', name: '原组织' },
      orders: [{ id: 'order-1' }],
      inquiries: [{ id: 'inquiry-1' }],
      payables: [{ orderId: 'order-1', id: 'receivable-1', overdueDays: -1, trigger: 'normal' }],
    });
    expect(mocks.requireOrganizationPermission).toHaveBeenCalledWith('owner-1', 'org-1', 'organization.records.read');
    expect(mocks.orderFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-1', ownerScope: 'organization' } }));
    expect(mocks.orderFindMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        pointsPersonal: true,
        pointsGroup: true,
        pointsGroupId: true,
        pointsDiscount: true,
        pointsRefundedPersonal: true,
        pointsRefundedGroup: true,
        researchGroup: expect.any(Object),
      }),
    }));
    expect(mocks.inquiryFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-1', ownerScope: 'organization' } }));
  });

  it('denies an exited member before any historical records are queried', async () => {
    const error = new mocks.OrganizationRbacError('MEMBERSHIP_NOT_FOUND', '组织成员关系不存在');
    mocks.requireActiveSession.mockResolvedValue({ id: 'former-member', email: 'former@test.com', role: 'customer' });
    mocks.requireOrganizationPermission.mockRejectedValue(error);
    mocks.organizationRbacErrorStatus.mockReturnValue(404);

    const response = await GET(new Request('http://localhost/api/organizations/org-1/history'), { params: Promise.resolve({ id: 'org-1' }) });

    expect(response.status).toBe(404);
    expect(mocks.orderFindMany).not.toHaveBeenCalled();
    expect(mocks.inquiryFindMany).not.toHaveBeenCalled();
  });

  it('returns the existing session response without querying records', async () => {
    mocks.requireActiveSession.mockResolvedValue(NextResponse.json({ error: '未登录' }, { status: 401 }));
    const response = await GET(new Request('http://localhost/api/organizations/org-1/history'), { params: Promise.resolve({ id: 'org-1' }) });
    expect(response.status).toBe(401);
    expect(mocks.requireOrganizationPermission).not.toHaveBeenCalled();
  });
});
