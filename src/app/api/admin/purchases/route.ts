import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import type { AdminPermissionKey } from '@/lib/admin-permissions';
import { getAdminPermissions, requireAdmin } from '@/lib/session';
import { consumeSecurityStepUpGrant } from '@/lib/security/security-step-up';
import { extractStepUpToken } from '@/lib/admin-order-step-up';
import { prisma } from '@/lib/prisma';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import {
  applyPurchaseAction, applyPurchaseShipment, prepareOrderPurchases, previewPurchaseAction, previewPurchaseShipment,
  purchaseWorkspace, savePurchaseLine, type PurchaseActionInput,
} from '@/lib/purchase-orders';
import type { ShipmentAttributionInput } from '@/lib/purchase-fulfillment';
import { applyPurchaseStartAction, previewPurchaseStartAction, type PurchaseStartInput } from '@/lib/purchase-start';
import { PurchaseError, requiredText } from '@/lib/purchase-terms';

function failure(error: unknown) {
  if (error instanceof PurchaseError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && error.message === '未找到原客户订单') return NextResponse.json({ error: error.message }, { status: 404 });
  const code = (error as { code?: string })?.code;
  if (code === 'P2034' || code === 'P2002' || (code === 'P2010' && /unique|locked|busy/i.test(String((error as Error).message)))) {
    return NextResponse.json({ error: '采购资料被其他操作更新，请重新核对原记录' }, { status: 409 });
  }
  console.error('[admin/purchases]', error instanceof Error ? error.name : 'database operation failed');
  return NextResponse.json({ error: '采购记录处理失败，请核对原单后重试' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAdmin('purchases.read');
    if (user instanceof NextResponse) return user;
    const permissions = (await getAdminPermissions(user))
      .filter(permission => permission.startsWith('purchases.') || permission === 'orders.write' || permission === 'finance.write');
    const orderId = req.nextUrl.searchParams.get('orderId')?.trim();
    if (orderId) return NextResponse.json({ permissions, workspace: await prisma.$transaction(tx => purchaseWorkspace(tx, orderId)) });
    const query = (req.nextUrl.searchParams.get('search') ?? '').trim().slice(0, 200);
    const rows = await prisma.$queryRaw<{ id: string; status: string; prepared: bigint; purchases: bigint }[]>`
      SELECT o.id,o.status,(SELECT COUNT(*) FROM PurchaseRequirement r WHERE r.orderId=o.id) AS prepared,
        (SELECT COUNT(*) FROM PurchaseOrder p WHERE p.orderId=o.id AND p.status<>'superseded') AS purchases
      FROM "Order" o WHERE (o.status IN ('confirmed','partially_shipped') AND o.archivedAt IS NULL
          AND EXISTS(SELECT 1 FROM OrderItem i WHERE i.orderId=o.id AND i.quantity>i.shippedQty)
        OR EXISTS(SELECT 1 FROM PurchaseRequirement r WHERE r.orderId=o.id))
        AND (instr(lower(o.id),lower(${query}))>0 OR EXISTS(SELECT 1 FROM PurchaseOrder p WHERE p.orderId=o.id AND instr(lower(p.id),lower(${query}))>0))
      ORDER BY o.createdAt DESC,o.id LIMIT 100`;
    return NextResponse.json({ permissions, orders: rows.map(row => ({ ...row, prepared: Number(row.prepared), purchases: Number(row.purchases) })) });
  } catch (error) { return failure(error); }
}

const purchasePermissions = {
  approve: 'purchases.approve', approve_lead_time: 'purchases.approve', register_order: 'purchases.write',
  record_payment: 'purchases.pay', review_payment_time: 'purchases.pay', report_change: 'purchases.write', review_change_scope: 'purchases.read', resolve_change: 'purchases.read',
  record_payment_exception: 'purchases.pay', review_payment_exception: 'purchases.pay',
  approve_payment_attribution: 'purchases.approve', correct_payment_attribution: 'purchases.pay',
  review_legacy_approval: 'purchases.approve', approve_remaining: 'purchases.approve', record_late_order_exception: 'purchases.approve',
  reapprove_purchase: 'purchases.approve', resolve_order_exception: 'purchases.approve',
} as const satisfies Record<PurchaseActionInput['action'], AdminPermissionKey>;

const startPermissions = {
  verify_acceptance: 'orders.write', review_customer_terms: 'finance.write',
  verify_bank_receipt: 'finance.write', record_customer_receipt: 'finance.write', approve_credit_exception: 'finance.write',
} as const satisfies Record<PurchaseStartInput['action'], AdminPermissionKey>;

async function requireResolutionPermission(tx: Prisma.TransactionClient, order: PurchaseActionInput | null, permissions: AdminPermissionKey[]) {
  if (order?.action !== 'resolve_change' && order?.action !== 'review_change_scope') return null;
  const [commitment] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM PurchaseActivity
    WHERE orderId=${order.orderId} AND purchaseOrderId=${order.purchaseOrderId}
      AND (action IN ('register_order','record_payment','correct_payment_attribution') OR (action='record_late_order_exception'
        AND json_extract(detail,'$.snapshot.operation.category')='credit')) LIMIT 1`;
  const permission = commitment ? 'purchases.approve' : 'purchases.write';
  if (!permissions.includes(permission)) {
    throw new PurchaseError(commitment ? '已订购或已付款的处理结果须由采购审批人员核对' : '当前账号没有采购经办权限', 403);
  }
  return permission;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PurchaseError('无效的采购请求', 400);
    const draft = body.action === 'prepare' || body.action === 'save_line';
    const start = Object.hasOwn(startPermissions, body.action);
    const attribution = body.action === 'attribute_purchase_shipment';
    if (!draft && !start && !attribution && !Object.hasOwn(purchasePermissions, body.action)) throw new PurchaseError('无法识别的采购动作', 400);
    const permission = draft ? 'purchases.write'
      : attribution ? 'purchases.approve'
        : start ? startPermissions[body.action as PurchaseStartInput['action']] : purchasePermissions[body.action as PurchaseActionInput['action']];
    const user = await requireAdmin(permission, { skipStepUp: true });
    if (user instanceof NextResponse) return user;
    const actor = { id: user.id, email: user.email };
    const permissions = await getAdminPermissions(user);
    if (!permissions.includes('purchases.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const orderId = requiredText(body.orderId, '原订单编号');
    if (draft) {
      const workspace = await prisma.$transaction(async tx => {
        if (body.action === 'prepare') return prepareOrderPurchases(tx, orderId, actor, true);
        if (!Number.isSafeInteger(body.revision)) throw new PurchaseError('请重新加载采购行版本');
        return savePurchaseLine(tx, {
          orderId, orderItemId: requiredText(body.orderItemId, '原订单行编号'), revision: body.revision,
          terms: body.terms, checkedEvidence: body.checkedEvidence === true,
        }, actor);
      }, { isolationLevel: 'Serializable' });
      return NextResponse.json({ workspace });
    }

    const base = { orderId, version: requiredText(body.version, '审批内容版本'),
      requestId: requiredText(body.requestId, '操作编号'), actionHash: body.actionHash };
    const orderReview: PurchaseStartInput | null = start ? {
      ...base, action: body.action, reference: body.reference, sha256: body.sha256, description: body.description,
      historyId: body.historyId, originalActor: body.originalActor, authorityReference: body.authorityReference, occurredAt: body.occurredAt,
      paymentMode: body.paymentMode, requiredPrepayCents: body.requiredPrepayCents, balanceTerms: body.balanceTerms,
      transactionReference: body.transactionReference, allocationReference: body.allocationReference,
      receiptKind: body.receiptKind, receiptTotalCents: body.receiptTotalCents, amountCents: body.amountCents,
      bankTrace: body.bankTrace, receivingAccount: body.receivingAccount, payer: body.payer, documentKind: body.documentKind,
      statementRow: body.statementRow, bankReceiptId: body.bankReceiptId, legacyAllocationId: body.legacyAllocationId,
    } : null;
    const shipment: ShipmentAttributionInput | null = attribution ? { ...base, targetId: body.targetId, sources: body.sources,
      reference: body.reference, sha256: body.sha256, description: body.description, occurredAt: body.occurredAt, documentRow: body.documentRow } : null;
    const purchase: PurchaseActionInput | null = start || attribution ? null : {
      ...base, purchaseOrderId: requiredText(body.purchaseOrderId, '采购单号'), action: body.action,
      reference: body.reference, referenceSha256: body.referenceSha256, occurredAt: body.occurredAt,
      sourcePaymentId: body.sourcePaymentId, bankTrace: body.bankTrace, payee: body.payee,
      paymentDocumentKind: body.paymentDocumentKind, paymentStatementRow: body.paymentStatementRow,
      paymentIssueId: body.paymentIssueId, paymentIssueOutcome: body.paymentIssueOutcome,
      paymentIssueTargetPurchaseOrderId: body.paymentIssueTargetPurchaseOrderId,
      amountCents: body.amountCents, conditionReference: body.conditionReference, changeKind: body.changeKind,
      description: body.description, outcome: body.outcome, supplierReference: body.supplierReference,
      supplierSha256: body.supplierSha256, customerReference: body.customerReference, customerSha256: body.customerSha256,
      revisedTerms: body.revisedTerms, retainedDraftTerms: body.retainedDraftTerms, dispositions: body.dispositions, refundFollowup: body.refundFollowup,
      decisionDocumentLines: body.decisionDocumentLines, incidentId: body.incidentId, reviewResult: body.reviewResult, relatedIncidentId: body.relatedIncidentId, affectedLines: body.affectedLines, coordinationLines: body.coordinationLines,
      confirmsFullIncidentScope: body.confirmsFullIncidentScope, responsibility: body.responsibility, shortfallHandoffKey:body.shortfallHandoffKey,
      paymentReference: body.paymentReference, paymentSha256: body.paymentSha256, leadTimeReference: body.leadTimeReference,
      leadTimeSha256: body.leadTimeSha256, remainingLines: body.remainingLines, appliedPaidCents: body.appliedPaidCents,
      exceptionOutcome: body.exceptionOutcome,
      exceptionId: body.exceptionId, exceptionResolution: body.exceptionResolution,
      documentScopes: body.documentScopes,
    };
    if (body.stage === 'preview') {
      const preview = await prisma.$transaction(async tx => {
        if (shipment) return previewPurchaseShipment(tx, shipment, actor);
        await requireResolutionPermission(tx, purchase, permissions);
        if (orderReview) return previewPurchaseStartAction(tx, orderReview, actor);
        return previewPurchaseAction(tx, purchase!, actor);
      });
      return NextResponse.json({ preview });
    }
    if (body.stage !== 'confirm' || typeof base.actionHash !== 'string' || !/^[a-f0-9]{64}$/.test(base.actionHash)) {
      throw new PurchaseError('请先查看完整操作预览');
    }
    const token = extractStepUpToken(body);
    if (!token || !user.sessionId || !await consumeSecurityStepUpGrant(token, { userId: user.id, sessionId: user.sessionId, action: 'admin_sensitive' })) {
      return NextResponse.json({ error: 'Admin MFA required' }, { status: 403 });
    }
    const workspace = await prisma.$transaction(async tx => {
      const approvalPermission = await requireResolutionPermission(tx, purchase, permissions) ?? permission;
      const authorization = { action: 'admin_sensitive' as const, permission: approvalPermission,
        sessionFingerprint: pricingContentHash({ userId: user.id, sessionId: user.sessionId }), verifiedAt: new Date().toISOString() };
      if (shipment) return applyPurchaseShipment(tx, shipment, actor, authorization);
      if (purchase) return applyPurchaseAction(tx, purchase, actor, authorization);
      await applyPurchaseStartAction(tx, orderReview!, actor, authorization);
      return prepareOrderPurchases(tx, orderId, actor);
    }, { isolationLevel: 'Serializable' });
    return NextResponse.json({ workspace });
  } catch (error) { return failure(error); }
}
