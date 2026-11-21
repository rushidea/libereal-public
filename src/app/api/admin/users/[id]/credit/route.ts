import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireAdminStepUp } from '@/lib/session';
import { isAdminMfaScenarioEnabled } from '@/lib/admin-mfa-settings';
import {
  ensureCreditAccount,
  parseTemporaryUntilInput,
  summarizeCustomerCredit,
} from '@/lib/customer-credit';
import { consumeSecurityStepUpGrant, hasSecurityStepUpGrant } from '@/lib/security/security-step-up';
import { writeAuditLog } from '@/lib/audit';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('finance.read');
  if (admin instanceof NextResponse) return admin;
  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, tier: true } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const account = await prisma.$transaction((tx) => ensureCreditAccount(tx, user.id, user.tier));
  return NextResponse.json({ account: { ...account, ...summarizeCustomerCredit(user, account) } });
}

function parseNumericField(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && raw.trim() !== '') return Number(raw);
  return Number.NaN;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: '请求格式无效' }, { status: 400 });
  }
  const stepUpToken = typeof body.stepUpToken === 'string' && body.stepUpToken.trim()
    ? body.stepUpToken.trim()
    : undefined;
  const admin = stepUpToken
    ? await requireAdmin('finance.write', { token: stepUpToken, action: 'admin_sensitive' })
    : await requireAdmin('finance.write');
  if (admin instanceof NextResponse) return admin;
  const creditScenarioEnabled = await isAdminMfaScenarioEnabled('credit.adjust');
  const hasValidStepUpGrant = Boolean(
    stepUpToken
    && admin.sessionId
    && await hasSecurityStepUpGrant(stepUpToken, {
      userId: admin.id,
      sessionId: admin.sessionId,
      action: 'admin_sensitive',
    }),
  );
  if (stepUpToken && !hasValidStepUpGrant) {
    return NextResponse.json({ error: 'Admin MFA required' }, { status: 403 });
  }
  if (creditScenarioEnabled && !stepUpToken) {
    const creditAdmin = await requireAdminStepUp(admin);
    if (creditAdmin instanceof NextResponse) return creditAdmin;
  }

  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, tier: true } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const overrideLimit = body.overrideLimit === undefined ? undefined : body.overrideLimit === null ? null : parseNumericField(body.overrideLimit);
  const temporaryLimit = body.temporaryLimit === undefined ? undefined : parseNumericField(body.temporaryLimit);
  const paymentTermDays = body.paymentTermDays === undefined ? undefined : parseNumericField(body.paymentTermDays);
  if (overrideLimit !== undefined && overrideLimit !== null && (!Number.isFinite(overrideLimit) || overrideLimit < 0)) return NextResponse.json({ error: '永久额度无效' }, { status: 400 });
  if (temporaryLimit !== undefined && (!Number.isFinite(temporaryLimit) || temporaryLimit < 0)) return NextResponse.json({ error: '临时额度无效' }, { status: 400 });
  if (paymentTermDays !== undefined && (!Number.isInteger(paymentTermDays) || paymentTermDays < 1 || paymentTermDays > 365)) return NextResponse.json({ error: '账期天数需为 1 到 365 的整数' }, { status: 400 });
  if (body.status !== undefined && (typeof body.status !== 'string' || !['active', 'paused', 'credit_limited', 'overdue_hold'].includes(body.status))) {
    return NextResponse.json({ error: '授信状态无效' }, { status: 400 });
  }
  const parsedTemporaryUntil = body.temporaryUntil === undefined
    ? null
    : parseTemporaryUntilInput(body.temporaryUntil);
  if (parsedTemporaryUntil && !parsedTemporaryUntil.ok) {
    return NextResponse.json({ error: parsedTemporaryUntil.error }, { status: 400 });
  }
  const existingAccountSnapshot = await prisma.creditAccount.findUnique({
    where: { userId: id },
    select: { temporaryLimit: true, temporaryUntil: true },
  });
  const prospectiveTemporaryLimit = temporaryLimit !== undefined
    ? temporaryLimit
    : (existingAccountSnapshot?.temporaryLimit ?? 0);
  const prospectiveTemporaryUntil = prospectiveTemporaryLimit === 0
    ? null
    : (parsedTemporaryUntil ? parsedTemporaryUntil.value : (existingAccountSnapshot?.temporaryUntil ?? null));
  if (prospectiveTemporaryLimit > 0 && !prospectiveTemporaryUntil) {
    return NextResponse.json({ error: '设置临时额度时必须填写到期日' }, { status: 400 });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  const effectiveReason = reason || '管理员调整授信';

  if (stepUpToken) {
    const consumed = Boolean(
      admin.sessionId
      && await consumeSecurityStepUpGrant(stepUpToken, {
        userId: admin.id,
        sessionId: admin.sessionId,
        action: 'admin_sensitive',
      }),
    );
    if (!consumed) {
      return NextResponse.json({ error: 'Admin MFA required' }, { status: 403 });
    }
  }

  try {
    const account = await prisma.$transaction(async (tx) => {
      const previous = await ensureCreditAccount(tx, user.id, user.tier);
      const nextTemporaryLimit = temporaryLimit !== undefined ? temporaryLimit : previous.temporaryLimit;
      const nextTemporaryUntil = nextTemporaryLimit === 0
        ? null
        : (parsedTemporaryUntil ? parsedTemporaryUntil.value : previous.temporaryUntil);
      if (nextTemporaryLimit > 0 && !nextTemporaryUntil) {
        throw new Error('TEMPORARY_UNTIL_REQUIRED');
      }
      const nextStatus = typeof body.status === 'string' ? body.status : undefined;
      const updated = await tx.creditAccount.update({
        where: { userId: id },
        data: {
          ...(overrideLimit !== undefined ? { overrideLimit } : {}),
          ...(temporaryLimit !== undefined ? { temporaryLimit } : {}),
          ...(parsedTemporaryUntil || nextTemporaryLimit === 0 ? { temporaryUntil: nextTemporaryUntil } : {}),
          ...(paymentTermDays !== undefined ? { paymentTermDays } : {}),
          ...(nextStatus !== undefined ? {
            status: nextStatus,
            statusSource: nextStatus === 'active' ? 'system' : 'manual',
            ...(nextStatus === 'active' ? { manuallyUnlockedAt: new Date() } : {}),
          } : {}),
        },
      });
      await tx.creditTransaction.create({ data: { userId: id, type: 'admin_adjust', amount: 0, balanceAfter: updated.usedAmount, reason: effectiveReason, actorId: admin.id } });
      await writeAuditLog({ actorId: admin.id, actorEmail: admin.email, action: 'customer.credit_changed', resource: 'customers', targetType: 'CreditAccount', targetId: updated.id, before: previous, after: updated, reason: effectiveReason }, tx);
      return updated;
    });
    return NextResponse.json({ account: { ...account, ...summarizeCustomerCredit(user, account) } });
  } catch (err) {
    if (err instanceof Error && err.message === 'TEMPORARY_UNTIL_REQUIRED') {
      return NextResponse.json({ error: '设置临时额度时必须填写到期日' }, { status: 400 });
    }
    throw err;
  }
}
