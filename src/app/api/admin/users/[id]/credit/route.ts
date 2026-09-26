import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireAdminStepUp } from '@/lib/session';
import { isAdminMfaScenarioEnabled } from '@/lib/admin-mfa-settings';
import { creditLimitForAccount, ensureCreditAccount } from '@/lib/customer-credit';
import { writeAuditLog } from '@/lib/audit';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('customers.read');
  if (admin instanceof NextResponse) return admin;
  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, tier: true } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const account = await prisma.$transaction((tx) => ensureCreditAccount(tx, user.id, user.tier));
  const effectiveLimit = creditLimitForAccount(account);
  return NextResponse.json({ account: { ...account, effectiveLimit, availableAmount: effectiveLimit - account.usedAmount } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('customers.write');
  if (admin instanceof NextResponse) return admin;
  const creditScenarioEnabled = await isAdminMfaScenarioEnabled('credit.adjust');
  const creditAdmin = creditScenarioEnabled ? await requireAdminStepUp(admin) : admin;
  if (creditAdmin instanceof NextResponse) return creditAdmin;
  const { id } = await params;
  const body = await req.json();
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, tier: true } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const overrideLimit = body.overrideLimit === undefined ? undefined : body.overrideLimit === null ? null : Number(body.overrideLimit);
  const temporaryLimit = body.temporaryLimit === undefined ? undefined : Number(body.temporaryLimit);
  const paymentTermDays = body.paymentTermDays === undefined ? undefined : Number(body.paymentTermDays);
  if (overrideLimit !== undefined && overrideLimit !== null && (!Number.isFinite(overrideLimit) || overrideLimit < 0)) return NextResponse.json({ error: 'Invalid overrideLimit' }, { status: 400 });
  if (temporaryLimit !== undefined && (!Number.isFinite(temporaryLimit) || temporaryLimit < 0)) return NextResponse.json({ error: 'Invalid temporaryLimit' }, { status: 400 });
  if (paymentTermDays !== undefined && (!Number.isInteger(paymentTermDays) || paymentTermDays < 1 || paymentTermDays > 365)) return NextResponse.json({ error: 'Invalid paymentTermDays' }, { status: 400 });
  if (body.status !== undefined && !['active', 'paused', 'credit_limited', 'overdue_hold'].includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  const account = await prisma.$transaction(async (tx) => {
    const previous = await ensureCreditAccount(tx, user.id, user.tier);
    const updated = await tx.creditAccount.update({
      where: { userId: id },
      data: {
        ...(body.overrideLimit !== undefined ? { overrideLimit } : {}),
        ...(temporaryLimit !== undefined ? { temporaryLimit } : {}),
        ...(body.temporaryUntil !== undefined ? { temporaryUntil: body.temporaryUntil ? new Date(body.temporaryUntil) : null } : {}),
        ...(paymentTermDays !== undefined ? { paymentTermDays } : {}),
        ...(body.status !== undefined ? { status: body.status, manuallyUnlockedAt: body.status === 'active' ? new Date() : undefined } : {}),
      },
    });
    await tx.creditTransaction.create({ data: { userId: id, type: 'admin_adjust', amount: 0, balanceAfter: updated.usedAmount, reason: body.reason || '管理员调整授信', actorId: admin.id } });
    await writeAuditLog({ actorId: admin.id, actorEmail: admin.email, action: 'customer.credit_changed', resource: 'customers', targetType: 'CreditAccount', targetId: updated.id, before: previous, after: updated, reason: body.reason || '管理员调整授信' }, tx);
    return updated;
  });
  const effectiveLimit = creditLimitForAccount(account);
  return NextResponse.json({ account: { ...account, effectiveLimit, availableAmount: effectiveLimit - account.usedAmount } });
}
