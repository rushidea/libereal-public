import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { retryBackgroundTask } from '@/lib/background-tasks';
import { writeAuditLog } from '@/lib/audit';

const STATUSES = new Set(['pending', 'running', 'succeeded', 'failed']);

export async function GET(req: NextRequest) {
  const admin = await requireAdmin('tasks.read');
  if (admin instanceof NextResponse) return admin;

  const searchParams = new URL(req.url).searchParams;
  const status = searchParams.get('status')?.trim() || '';
  const type = searchParams.get('type')?.trim() || '';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const limit = Math.min(100, Math.max(10, Number(searchParams.get('limit')) || 30));
  if (status && !STATUSES.has(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  const where = { ...(status ? { status } : {}), ...(type ? { type } : {}) };
  const [tasks, total, statusCounts, types] = await Promise.all([
    prisma.backgroundTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.backgroundTask.count({ where }),
    prisma.backgroundTask.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.backgroundTask.findMany({ select: { type: true }, distinct: ['type'], orderBy: { type: 'asc' } }),
  ]);
  return NextResponse.json({
    tasks,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / limit)),
    counts: Object.fromEntries(statusCounts.map((item) => [item.status, item._count._all])),
    types: types.map((item) => item.type),
  });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin('tasks.manage');
  if (admin instanceof NextResponse) return admin;
  const body = await req.json().catch(() => null) as { id?: unknown; action?: unknown } | null;
  if (typeof body?.id !== 'string' || body.action !== 'retry') {
    return NextResponse.json({ error: 'id and retry action required' }, { status: 400 });
  }

  const previous = await prisma.backgroundTask.findUnique({ where: { id: body.id } });
  if (!previous) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  const task = await retryBackgroundTask(body.id);
  if (!task) return NextResponse.json({ error: 'Only failed tasks can be retried' }, { status: 409 });
  await writeAuditLog({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'task.retried',
    resource: 'tasks',
    targetType: 'BackgroundTask',
    targetId: task.id,
    before: { status: previous.status, attempts: previous.attempts, lastError: previous.lastError },
    after: { status: task.status, attempts: task.attempts },
    reason: '管理员重新执行失败任务',
  });
  return NextResponse.json({ task });
}
