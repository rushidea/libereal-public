import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { canRetryGeneralTask, retryBackgroundTask } from '@/lib/background-tasks';
import { projectAiOpsTask } from '@/lib/ai-ops/tasks';
import { writeAuditLog } from '@/lib/audit';
import { deliveryReviewable, deliveryVersion, recordDeliveryReview } from '@/lib/task-delivery-review';
import { PURCHASE_CONTINUATION, PURCHASE_READY } from '@/lib/purchase-continuation-state';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { acknowledgeSupplierMailHeader, supplierMailReceiptConflict, supplierMailReceiptLink, supplierMailReceiptVersion,
  SUPPLIER_MAIL_HEADER_CURSOR, SUPPLIER_MAIL_HEADER_TASK, SUPPLIER_MAIL_HEADER_VIEW } from '@/lib/supplier-mail-headers';
import { isMailHash, isPositiveMailId, mailRecord, readMailRecord } from '@/lib/supplier-mail-header-source';

const STATUSES = new Set(['pending', 'running', 'succeeded', 'failed', 'awaiting_human', 'delivery_reviewed', PURCHASE_READY]);

export async function GET(req: NextRequest) {
  const admin = await requireAdmin('tasks.read');
  if (admin instanceof NextResponse) return admin;

  const searchParams = new URL(req.url).searchParams;
  const status = searchParams.get('status')?.trim() || '';
  const requestedType = searchParams.get('type')?.trim() || '';
  const type = requestedType === SUPPLIER_MAIL_HEADER_VIEW ? SUPPLIER_MAIL_HEADER_TASK : requestedType;
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const limit = Math.min(100, Math.max(10, Number(searchParams.get('limit')) || 30));
  if (status && !STATUSES.has(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  const visibleTask = { OR: [
    { type: SUPPLIER_MAIL_HEADER_TASK },
    { type: { not: { startsWith: 'aiops.control.' }, notIn: ['inquiry.supplier_mail_header_cursor'] } },
  ] };
  const where = { AND: [visibleTask, ...(status ? [{ status }] : []), ...(type ? [{ type }] : [])] };
  const [tasks, total, statusCounts, types] = await Promise.all([
    prisma.backgroundTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.backgroundTask.count({ where }),
    prisma.backgroundTask.groupBy({ by: ['status'], where: visibleTask, _count: { _all: true } }),
    prisma.backgroundTask.findMany({ where: visibleTask, select: { type: true }, distinct: ['type'], orderBy: { type: 'asc' } }),
  ]);
  return NextResponse.json({
    tasks: tasks.map((task) => {
      if (task.type === PURCHASE_CONTINUATION) {
        const orderId = jsonObject(task.payload).orderId;
        return { id: task.id, type: task.type, status: task.status, attempts: task.attempts, maxAttempts: task.maxAttempts,
          completedAt: task.completedAt, createdAt: task.createdAt, runAt: task.runAt, priority: task.priority,
          orderId: typeof orderId === 'string' ? orderId : null };
      }
      if (task.type === SUPPLIER_MAIL_HEADER_TASK || ['inquiry.supplier_mail_received', SUPPLIER_MAIL_HEADER_VIEW].includes(task.type)) {
        const isHeader = task.type === SUPPLIER_MAIL_HEADER_TASK;
        const emailId = isHeader ? mailRecord(readMailRecord(task.payload).header).emailId : null;
        return { ...task, type: isHeader ? SUPPLIER_MAIL_HEADER_VIEW : task.type, payload: null, result: null,
          lastError: null, mailEmailId: isPositiveMailId(emailId) ? emailId : null,
          mailConflict: isHeader && supplierMailReceiptConflict(task),
          mailReviewVersion: isHeader && task.status === 'awaiting_human' ? supplierMailReceiptVersion(task) : null,
          inquiryId: supplierMailReceiptLink(task)?.inquiryId ?? null };
      }
      if (task.type.startsWith('aiops.')) return projectAiOpsTask(task);
      if (task.type === 'inquiry.supplier_written_quote') {
        const scope = jsonObject(task.payload).scope as { inquiryId?: string } | undefined;
        return { ...task, payload: null, result: null, inquiryId: typeof scope?.inquiryId === 'string' ? scope.inquiryId : null };
      }
      if (deliveryReviewable(task) || task.status === 'delivery_reviewed') {
        return { id: task.id, type: task.type, status: task.status, attempts: task.attempts, maxAttempts: task.maxAttempts,
          completedAt: task.completedAt, createdAt: task.createdAt, runAt: task.runAt, priority: task.priority,
          deliveryVersion: deliveryReviewable(task) ? deliveryVersion(task) : null, deliveryOutcome: jsonObject(task.result).outcome ?? null };
      }
      return { ...task, lockedBy: null, canRetry: task.status === 'failed' && canRetryGeneralTask(task.type) };
    }),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / limit)),
    counts: Object.fromEntries(statusCounts.map((item) => [item.status, item._count._all])),
    types: [...new Set(types.map((item) => item.type === SUPPLIER_MAIL_HEADER_TASK ? SUPPLIER_MAIL_HEADER_VIEW : item.type))],
  });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin('tasks.manage');
  if (admin instanceof NextResponse) return admin;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (typeof body?.id !== 'string' || !body.id || body.id.length > 160
    || body.action !== 'retry' && body.action !== 'acknowledge_supplier_mail' && body.action !== 'record_delivery_review') {
    return NextResponse.json({ error: '缺少任务编号或操作不正确' }, { status: 400 });
  }
  if (body.action === 'record_delivery_review') {
    const taskId = body.id;
    const recorded = await prisma.$transaction(tx => recordDeliveryReview(tx, taskId, body, admin));
    return recorded ? NextResponse.json(recorded) : NextResponse.json({ error: '请核对本次记录、凭据及当前任务版本' }, { status: 409 });
  }
  if (body.action === 'acknowledge_supplier_mail') {
    const reviewer = await requireAdmin('inquiries.write');
    if (reviewer instanceof NextResponse) return reviewer;
    if (reviewer.id !== admin.id) return NextResponse.json({ error: '登录已变化，请刷新后重试' }, { status: 403 });
    if (!isMailHash(body.mailReviewVersion)) return NextResponse.json({ error: '请先刷新并核对当前收件待办' }, { status: 400 });
    try {
      if (!await acknowledgeSupplierMailHeader(body.id, body.mailReviewVersion, reviewer)) {
        return NextResponse.json({ error: '收件待办已变化，请刷新后重新核对' }, { status: 409 });
      }
      return NextResponse.json({ ok: true });
    } catch { return NextResponse.json({ error: '收件核对未关闭，请刷新后重试' }, { status: 503 }); }
  }

  const previous = await prisma.backgroundTask.findUnique({ where: { id: body.id } });
  if (!previous) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  if ([SUPPLIER_MAIL_HEADER_CURSOR, SUPPLIER_MAIL_HEADER_TASK, SUPPLIER_MAIL_HEADER_VIEW,
    'inquiry.supplier_mail_header_cursor', 'inquiry.supplier_mail_received'].includes(previous.type)) {
    return NextResponse.json({ error: '请在邮箱中人工核对收件，不要重放邮件' }, { status: 409 });
  }
  if (previous.type.startsWith('aiops.')) return NextResponse.json({ error: 'AI tasks cannot be retried automatically' }, { status: 409 });
  if (previous.type === 'inquiry.supplier_written_quote') return NextResponse.json({ error: '请在原询价中核对供应商回复或重新准备询价' }, { status: 409 });
  if (!canRetryGeneralTask(previous.type)) return NextResponse.json({ error: '请核对原业务及回执' }, { status: 409 });
  const task = await prisma.$transaction(async tx => {
    const updated = await retryBackgroundTask(previous.id, tx);
    if (updated) await writeAuditLog({ actorId: admin.id, actorEmail: admin.email,
      action: 'task.retried', resource: 'tasks', targetType: 'BackgroundTask', targetId: updated.id,
      before: { status: previous.status, attempts: previous.attempts, lastError: previous.lastError },
      after: { status: updated.status, attempts: updated.attempts }, reason: '管理员重新执行失败任务' }, tx);
    return updated;
  });
  if (!task) return NextResponse.json({ error: 'Only failed tasks can be retried' }, { status: 409 });
  return NextResponse.json({ task });
}
