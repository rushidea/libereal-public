import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { revalidateAiOpsActor } from '@/lib/ai-ops/business';
import { BUSINESS_WORKERS, isBusinessWorker, WORKER_PERMISSIONS } from '@/lib/ai-ops/business-tools';
import { AI_OPS_MODEL, aiOpsAvailability } from '@/lib/ai-ops/policy';
import { enqueueAiOpsTask, parseAiOpsPayload, projectAiOpsTask } from '@/lib/ai-ops/tasks';
import { sha256 } from '@/lib/ai-ops/model-client';
import { engineeringAvailability } from '@/lib/ai-ops/engineering-bridge';

export const runtime = 'nodejs';

async function readBoundedBody(req: NextRequest): Promise<string> {
  const reader = req.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 20_000) { await reader.cancel(); throw new Error('too_large'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}


export async function GET() {
  const admin = await requireAdmin('tasks.read');
  if (admin instanceof NextResponse) return admin;
  try {
    if (!admin.sessionId) return NextResponse.json({ error: 'Active session required' }, { status: 401 });
    const actor = await revalidateAiOpsActor({ id: admin.id, sessionId: admin.sessionId });
    if (!actor.permissions.includes('tasks.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const actorFragment = `"actor":{"id":${JSON.stringify(actor.id)},`;
    const [availability, engineering, rows] = await Promise.all([
      aiOpsAvailability(), engineeringAvailability(), prisma.backgroundTask.findMany({ where: { type: 'aiops.run', payload: { contains: actorFragment } }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    availability.available = availability.available && engineering.businessAvailable;
    if (!availability.available && !availability.reason) availability.reason = 'runner_offline';
    const tasks = rows.filter((row) => { try { return parseAiOpsPayload(row.payload).actor.id === actor.id; } catch { return false; } }).slice(0, 50).map(projectAiOpsTask);
    return NextResponse.json({ tasks, capabilities: { ...availability, model: AI_OPS_MODEL,
      domains: BUSINESS_WORKERS.map((id) => ({ id, requiredPermissions: WORKER_PERMISSIONS[id], available: availability.available && WORKER_PERMISSIONS[id].every((p) => actor.permissions.includes(p)) })),
      engineering: { ...engineering, available: availability.available && engineering.available && actor.permissions.includes('tasks.manage'), stagingAvailable: availability.available && engineering.stagingAvailable && actor.permissions.includes('tasks.manage') },
    } });
  } catch { return NextResponse.json({ error: 'AI operations unavailable' }, { status: 503 }); }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin('tasks.manage');
  if (admin instanceof NextResponse) return admin;
  if (!admin.sessionId) return NextResponse.json({ error: 'Active session required' }, { status: 401 });
  let raw: string;
  try { raw = await readBoundedBody(req); } catch { return NextResponse.json({ error: 'Request too large' }, { status: 400 }); }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  if (Object.keys(body).some((key) => !['request', 'kind', 'hint', 'idempotencyKey'].includes(key)) ||
    typeof body.request !== 'string' || !body.request.trim() || body.request.length > 4000 ||
    (body.kind !== undefined && !['auto', 'business', 'engineering'].includes(body.kind as string)) ||
    (body.hint !== undefined && !isBusinessWorker(body.hint)) ||
    (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.idempotencyKey)))) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  try {
    const actor = await revalidateAiOpsActor({ id: admin.id, sessionId: admin.sessionId });
    if (!actor.permissions.includes('tasks.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const availability = await aiOpsAvailability();
    if (!availability.available) return NextResponse.json({ error: 'AI provider unavailable', reason: availability.reason }, { status: 503 });
    const request = body.request.trim();
    const kind = (body.kind ?? 'auto') as 'auto' | 'business' | 'engineering';
    const workerId = typeof body.hint === 'string' ? body.hint : undefined;
    const dedupeKey = typeof body.idempotencyKey === 'string' ? `aiops:${sha256(`${actor.id}:${body.idempotencyKey}`)}` : undefined;
    if (dedupeKey) {
      const existing = await prisma.backgroundTask.findUnique({ where: { dedupeKey } });
      if (existing) {
        const payload = parseAiOpsPayload(existing.payload);
        if (existing.type !== 'aiops.run' || payload.actor.id !== actor.id || payload.request !== request || payload.kind !== kind || payload.workerId !== workerId) return NextResponse.json({ error: 'Idempotency key conflict' }, { status: 409 });
        return NextResponse.json({ task: projectAiOpsTask(existing) });
      }
    }
    const task = await enqueueAiOpsTask({ request, kind, workerId, actor: { id: actor.id, sessionId: actor.sessionId }, dedupeKey });
    return NextResponse.json({ task: projectAiOpsTask(task) }, { status: 202 });
  } catch { return NextResponse.json({ error: 'AI task could not be queued' }, { status: 503 }); }
}
