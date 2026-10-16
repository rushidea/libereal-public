import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { applyOrderAmountAdjustment } from '@/lib/order-amount-adjustment';
import { getAdminPermissions, requireAdmin } from '@/lib/session';

const TYPES = ['discount', 'shipping', 'tax', 'platform_fee', 'transfer_fee', 'manual'];

const CONFLICT_ERRORS = new Set([
  'ORDER_AMOUNT_LOCKED',
  'CREDIT_LIMIT_EXCEEDED',
  'CREDIT_ACCOUNT_SUSPENDED',
  'CREDIT_ACCOUNT_NOT_FOUND',
  'RECEIVABLE_NOT_FOUND',
  'CREDIT_USED_INVALID',
]);

async function requireOrderAmountAdmin() {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const permissions = await getAdminPermissions(admin);
  if (permissions.includes('orders.write')) return requireAdmin('orders.write');
  if (permissions.includes('finance.write')) return requireAdmin('finance.write');
  return NextResponse.json({ error: 'Forbidden', requiredPermission: 'orders.write' }, { status: 403 });
}

function adjustmentErrorResponse(error: unknown, logLabel: string) {
  const message = error instanceof Error ? error.message : '';
  if (message === 'ORDER_NOT_FOUND' || message === 'ADJUSTMENT_NOT_FOUND') {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  if (message === 'INVALID_ORDER_AMOUNT' || message === 'INVALID_ADJUSTMENT') {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (CONFLICT_ERRORS.has(message)) {
    return NextResponse.json({ error: message }, { status: 409 });
  }
  console.error(logLabel, error instanceof Error ? error.message : 'unknown');
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireOrderAmountAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    const { id } = await params;
    const body = await req.json();
    if (!TYPES.includes(body.type) || typeof body.label !== 'string' || !body.label.trim() || !Number.isFinite(body.amount)) {
      return NextResponse.json({ error: 'INVALID_ADJUSTMENT' }, { status: 400 });
    }
    const result = await prisma.$transaction((tx) => applyOrderAmountAdjustment(tx, {
      orderId: id,
      actor: { id: admin.id, email: admin.email },
      change: {
        op: 'create',
        type: body.type,
        label: body.label.trim(),
        amount: body.amount,
        reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null,
      },
    }));
    return NextResponse.json({ adjustment: result.adjustment, total: result.total }, { status: 201 });
  } catch (error) {
    return adjustmentErrorResponse(error, '[admin order adjustment POST] error:');
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireOrderAmountAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    const { id } = await params;
    const { adjustmentId } = await req.json();
    if (typeof adjustmentId !== 'string' || !adjustmentId) {
      return NextResponse.json({ error: 'INVALID_ADJUSTMENT' }, { status: 400 });
    }
    const result = await prisma.$transaction((tx) => applyOrderAmountAdjustment(tx, {
      orderId: id,
      actor: { id: admin.id, email: admin.email },
      change: { op: 'delete', adjustmentId },
    }));
    return NextResponse.json({ success: true, total: result.total });
  } catch (error) {
    return adjustmentErrorResponse(error, '[admin order adjustment DELETE] error:');
  }
}
