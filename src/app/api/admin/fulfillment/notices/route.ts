import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const admin = await requireAdmin('orders.read');
  if (admin instanceof NextResponse) return admin;
  const after = req.nextUrl.searchParams.get('after')?.trim() || null;
  const rows = await prisma.fulfillmentEvent.findMany({ where: { parcelId: null, status: 'pending', source: { startsWith: 'carrier/' },
    ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: 'asc' }, take: 51,
    select: { id: true, kind: true, source: true, occurredAt: true, details: true, reference: true } });
  const notices = rows.slice(0,50).map(row => {
    const details = JSON.parse(row.details) as { carrier: string; trackingNumber: string; description: string };
    return { id: row.id, source: row.source, kind: row.kind, occurredAt: row.occurredAt, reference: row.reference,
      carrier: details.carrier, trackingNumber: details.trackingNumber, description: details.description };
  });
  return NextResponse.json({ notices, next: rows.length > 50 ? notices.at(-1)!.id : null },
    { headers: { 'Cache-Control': 'private, no-store' } });
}
