import { NextRequest, NextResponse } from 'next/server';
import { authenticateCarrier, receiveCarrierNotice } from '@/lib/fulfillment-carrier';
import { prisma } from '@/lib/prisma';
import { PurchaseError } from '@/lib/purchase-terms';

async function payload(req: NextRequest) {
  const limit = 64 * 1024;
  if (Number(req.headers.get('content-length')) > limit) throw new PurchaseError('物流通知过大',413);
  const reader = req.body?.getReader();
  if (!reader) throw new PurchaseError('缺少物流通知',400);
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new PurchaseError('物流通知过大',413); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts);
}

export async function POST(req: NextRequest) {
  try {
    const raw = await payload(req);
    const source = authenticateCarrier(raw,req.headers.get('x-libereal-signature'));
    let input: unknown;
    try { input = JSON.parse(raw.toString('utf8')); } catch { throw new PurchaseError('物流数据格式不正确',400); }
    const result = await prisma.$transaction(tx => receiveCarrierNotice(tx,source,input),{ isolationLevel: 'Serializable' });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PurchaseError) return NextResponse.json({ error: error.message },{ status: error.status });
    if (['P2002','P2034'].includes((error as { code?: string })?.code ?? '')) {
      return NextResponse.json({ error: '同时收到其他进展，请使用同一事件编号重试' },{ status: 409 });
    }
    console.error('[carrier notice]',error instanceof Error ? error.name : 'unavailable');
    return NextResponse.json({ error: '物流通知暂时无法受理' },{ status: 500 });
  }
}
