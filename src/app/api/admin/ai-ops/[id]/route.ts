import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { revalidateAiOpsActor } from '@/lib/ai-ops/business';
import { isBusinessWorker, WORKER_PERMISSIONS } from '@/lib/ai-ops/business-tools';
import { cancelAiOpsTask, parseAiOpsPayload, parseAiOpsSummary, projectAiOpsTask } from '@/lib/ai-ops/tasks';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  const admin = await requireAdmin('tasks.read');
  if (admin instanceof NextResponse) return admin;
  if (!admin.sessionId) return NextResponse.json({ error: 'Active session required' }, { status: 401 });
  try {
    const actor = await revalidateAiOpsActor({ id: admin.id, sessionId: admin.sessionId });
    if (!actor.permissions.includes('tasks.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id } = await context.params;
    const task = await prisma.backgroundTask.findFirst({ where: { id, type: 'aiops.run' } });
    if (!task || parseAiOpsPayload(task.payload).actor.id !== actor.id) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    const summary = parseAiOpsSummary(task.result);
    let output: string | undefined;
    if (summary?.kind === 'business' && isBusinessWorker(summary.workerId) && WORKER_PERMISSIONS[summary.workerId].every((p) => actor.permissions.includes(p)) && typeof summary.output === 'string') {
      // Business output is a validated, host-built draft. Never expose payload, model envelopes,
      // session identifiers, internal call journals, raw errors or engineering model output.
      const draft = JSON.parse(summary.output) as Record<string, unknown>;
      if (draft.version === 1 && draft.workerId === summary.workerId && typeof draft.asOf === 'string' && typeof draft.source === 'string' && draft.analysis && typeof draft.analysis === 'object') {
        const analysis = draft.analysis as Record<string, unknown>;
        const safeList = (value: unknown) => Array.isArray(value) && value.length <= 12 && value.every((s) => typeof s === 'string' && s.length <= 2000);
        if (typeof analysis.summary === 'string' && analysis.summary.length <= 4000 && typeof analysis.draft === 'string' && analysis.draft.length <= 8000 && safeList(analysis.observations) && safeList(analysis.limitations)) {
          output = JSON.stringify({ version: 1, workerId: draft.workerId, asOf: draft.asOf, source: draft.source,
            analysis: { summary: analysis.summary, draft: analysis.draft, observations: analysis.observations, limitations: analysis.limitations } });
        }
      }
    }
    return NextResponse.json({ task: projectAiOpsTask(task), ...(output ? { output } : {}) });
  } catch { return NextResponse.json({ error: 'AI task unavailable' }, { status: 503 }); }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const admin = await requireAdmin('tasks.manage');
  if (admin instanceof NextResponse) return admin;
  if (!admin.sessionId) return NextResponse.json({ error: 'Active session required' }, { status: 401 });
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || (body as { action?: unknown }).action !== 'cancel') return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  try {
    const actor = await revalidateAiOpsActor({ id: admin.id, sessionId: admin.sessionId });
    if (!actor.permissions.includes('tasks.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id } = await context.params;
    const task = await prisma.backgroundTask.findFirst({ where: { id, type: 'aiops.run' } });
    if (!task || parseAiOpsPayload(task.payload).actor.id !== actor.id) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    const cancelled = await cancelAiOpsTask(id);
    return NextResponse.json({ cancelled }, { status: cancelled ? 200 : 409 });
  } catch { return NextResponse.json({ error: 'AI task unavailable' }, { status: 503 }); }
}
