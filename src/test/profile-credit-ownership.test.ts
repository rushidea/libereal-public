import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  userFindUnique: vi.fn(),
  transaction: vi.fn(),
  receivableFindMany: vi.fn(),
  getReadableOrganizationIds: vi.fn(),
  ensureCreditAccount: vi.fn(),
  creditLimitForAccount: vi.fn(),
  CREDIT_REVIEW_POLICY: { reminderAfterDays: 30, limitedAfterDays: 60, limitedCreditLimit: 5000, holdAfterDays: 90, reminderIntervalDays: 15 },
  creditRestrictionForOverdueDays: vi.fn(() => 'active'),
  overdueDaysFromDueAt: vi.fn(() => -1),
}));

vi.mock('@/lib/session', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    accountReceivable: { findMany: mocks.receivableFindMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/organization-record-access', () => ({ getReadableOrganizationIds: mocks.getReadableOrganizationIds }));
vi.mock('@/lib/customer-credit', () => ({
  ensureCreditAccount: mocks.ensureCreditAccount,
  creditLimitForAccount: mocks.creditLimitForAccount,
  CREDIT_REVIEW_POLICY: mocks.CREDIT_REVIEW_POLICY,
  creditRestrictionForOverdueDays: mocks.creditRestrictionForOverdueDays,
  overdueDaysFromDueAt: mocks.overdueDaysFromDueAt,
}));

import { GET } from '@/app/api/profile/credit/route';

describe('profile credit ownership boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: 'user-1' });
    mocks.userFindUnique.mockResolvedValue({ id: 'user-1', tier: 'standard' });
    mocks.transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({}));
    mocks.ensureCreditAccount.mockResolvedValue({ baseLimit: 1000, overrideLimit: null, temporaryLimit: 0, temporaryUntil: null, status: 'active', usedAmount: 0, paymentTermDays: 30 });
    mocks.creditLimitForAccount.mockReturnValue(1000);
    mocks.getReadableOrganizationIds.mockResolvedValue([]);
    mocks.receivableFindMany.mockResolvedValue([]);
  });

  it('keeps personal receivables visible while excluding organization receivables after exit', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.receivableFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: 'user-1',
        order: { OR: [{ ownerScope: 'personal' }] },
      }),
    }));
  });

  it('includes organization receivables only for organizations currently readable by the account', async () => {
    mocks.getReadableOrganizationIds.mockResolvedValue(['org-1']);
    await GET();

    expect(mocks.receivableFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        order: { OR: [{ ownerScope: 'personal' }, { ownerScope: 'organization', organizationId: { in: ['org-1'] } }] },
      }),
    }));
  });

  it('preserves the existing unauthenticated response', async () => {
    mocks.requireUser.mockResolvedValue(NextResponse.json({ error: '未登录' }, { status: 401 }));
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.receivableFindMany).not.toHaveBeenCalled();
  });
});
