import { createHmac, timingSafeEqual } from 'node:crypto';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { PurchaseError, requiredText } from '@/lib/purchase-terms';
import { confirmPreview, inputObject, parcelInclude, parcelKeys, parcelProgress, shipmentEvidence, verifyRepeat,
  type FulfillmentActor, type FulfillmentDb as Db } from '@/lib/fulfillment-records';

export function configuredCarrier() {
  const source = process.env.FULFILLMENT_CARRIER_SOURCE?.trim();
  const secret = process.env.FULFILLMENT_CARRIER_SECRET;
  return source && secret && Buffer.byteLength(secret) >= 32 ? { source, secret } : null;
}

export function authenticateCarrier(body: Uint8Array, signature: string | null) {
  const provider = configuredCarrier();
  if (!provider) throw new PurchaseError('当前没有启用物流数据接口', 503);
  const claimed = /^sha256=([0-9a-f]{64})$/i.exec(signature ?? '');
  const expected = createHmac('sha256', provider.secret).update(body).digest();
  if (!claimed || !timingSafeEqual(expected, Buffer.from(claimed[1], 'hex'))) throw new PurchaseError('物流来源验证失败', 401);
  return provider.source;
}

const noticeKinds = ['in_transit', 'carrier_delivered', 'exception'] as const;
type CarrierKind = typeof noticeKinds[number];

function carrierData(raw: unknown) {
  const input = inputObject(raw);
  if (!noticeKinds.includes(input.kind as CarrierKind)) throw new PurchaseError('无法识别物流事件', 400);
  return { eventId: requiredText(input.eventId, '承运方事件编号'), kind: input.kind as CarrierKind,
    carrier: requiredText(input.carrier, '承运方'), trackingNumber: requiredText(input.trackingNumber, '运单号'),
    description: requiredText(input.description, '物流进展'), ...shipmentEvidence(input) };
}

type Notice = { id: string; kind: string; occurredAt: Date; source: string; details: string; status: string; parcelId: string | null };
type Parcel = { id: string; status: string; dispatchedAt: Date; carrier: string | null; trackingNumber: string | null; feedSource: string | null };

function matches(notice: Notice, parcel: Parcel) {
  const details: { carrier: string; trackingNumber: string } = JSON.parse(notice.details);
  return notice.source === 'carrier/' + parcel.feedSource && parcel.carrier === details.carrier
    && parcel.trackingNumber === details.trackingNumber && parcel.dispatchedAt <= notice.occurredAt;
}

async function attach(tx: Db, notice: Notice, parcel: Parcel) {
  if (!matches(notice, parcel)) throw new PurchaseError('物流来源、运单、承运方或实际发货时间不符');
  const openException = notice.kind === 'carrier_exception' && !['delivered','shortfall'].includes(parcel.status);
  const changed = await tx.fulfillmentEvent.updateMany({ where: { id: notice.id, parcelId: null, status: 'pending' },
    data: { parcelId: parcel.id, status: openException ? 'awaiting_resolution' : 'linked' } });
  if (changed.count !== 1) throw new PurchaseError('物流通知已经处理，请刷新');
  await refreshProgress(tx, parcel.id);
}

async function refreshProgress(tx: Db, parcelId: string) {
  const parcel = await tx.fulfillmentParcel.findUniqueOrThrow({ where: { id: parcelId }, include: parcelInclude });
  const status = parcelProgress(parcel);
  if (status !== parcel.status) await tx.fulfillmentParcel.update({ where: { id: parcelId }, data: { status } });
}

function waybillCandidates(tx: Db, notice: Notice, source: string, carrier: string, trackingNumber: string) {
  return tx.fulfillmentParcel.findMany({ where: { feedSource: source, carrier, trackingNumber,
    dispatchedAt: { lte: notice.occurredAt } }, orderBy: { id: 'asc' } });
}

async function auditMatch(tx: Db, notice: Notice, parcelId: string, kind: 'carrier_auto_match' | 'carrier_match_withdrawn') {
  const original = await tx.fulfillmentEvent.findUniqueOrThrow({ where: { id: notice.id },
    select: { evidenceSha256: true, evidenceRow: true, contentHash: true } });
  const detail = { eventId: notice.id, originalContent: original.contentHash,
    description: kind === 'carrier_auto_match' ? '按当时唯一可核对的运单归属临时匹配' : '同一承运方运单出现多个可能归属，原自动匹配待人工核对' };
  await tx.fulfillmentEvent.create({ data: { ...parcelKeys(kind, parcelId, notice.id, { parcelId, noticeId: notice.id }, detail),
    parcelId, kind, source: 'system', status: 'applied', occurredAt: new Date(), reference: notice.id,
    evidenceSha256: original.evidenceSha256, evidenceRow: original.evidenceRow, details: JSON.stringify(detail) } });
}

async function reviewAutomaticMatch(tx: Db, notice: Notice, source: string, carrier: string, trackingNumber: string) {
  const possible = await waybillCandidates(tx, notice, source, carrier, trackingNumber);
  if (!notice.parcelId && notice.status === 'pending' && possible.length === 1) {
    await attach(tx, notice, possible[0]);
    await auditMatch(tx, notice, possible[0].id, 'carrier_auto_match');
  } else if (notice.parcelId && possible.length > 1) {
    const manual = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM FulfillmentEvent
      WHERE parcelId=${notice.parcelId} AND kind='match_carrier' AND status='applied' AND json_extract(details,'$.eventId')=${notice.id} LIMIT 1`;
    if (manual.length) return;
    const changed = await tx.fulfillmentEvent.updateMany({ where: { id: notice.id, parcelId: notice.parcelId, status: notice.status },
      data: { parcelId: null, status: 'pending' } });
    if (changed.count === 1) {
      await auditMatch(tx, notice, notice.parcelId, 'carrier_match_withdrawn');
      await refreshProgress(tx, notice.parcelId);
    }
  }
}

export async function receiveCarrierNotice(tx: Db, source: string, raw: unknown) {
  const { eventId, ...input } = carrierData(raw);
  const owner = 'carrier/' + source;
  const keys = parcelKeys('carrier_notice', owner, eventId, { source, reference: input.sha256, row: input.documentRow,
    carrier: input.carrier, trackingNumber: input.trackingNumber, kind: input.kind }, { source, ...input });
  let notice = verifyRepeat(await tx.fulfillmentEvent.findMany({ where: { OR: [{ requestKey: keys.requestKey }, { businessKey: keys.businessKey }] } }), keys);
  if (!notice) notice = await tx.fulfillmentEvent.create({ data: { ...keys, source: owner, kind: input.kind === 'exception' ? 'carrier_exception' : input.kind,
    status: 'pending', occurredAt: new Date(input.occurredAt), reference: input.reference, evidenceSha256: input.sha256, evidenceRow: input.documentRow,
    details: JSON.stringify({ eventId, carrier: input.carrier, trackingNumber: input.trackingNumber, description: input.description }) } });
  await reviewAutomaticMatch(tx, notice, source, input.carrier, input.trackingNumber);
  return tx.fulfillmentEvent.findUniqueOrThrow({ where: { id: notice.id }, select: { id: true, status: true } });
}

export async function pendingForWaybill(tx: Db, source: string, carrier: string, tracking: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM FulfillmentEvent WHERE source=${'carrier/'+source}
    AND status='pending' AND parcelId IS NULL AND json_extract(details,'$.carrier')=${carrier}
    AND json_extract(details,'$.trackingNumber')=${tracking} ORDER BY occurredAt,id`;
  if (!rows.length) return [];
  return tx.fulfillmentEvent.findMany({ where: { id: { in: rows.map(row => row.id) } }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
}

export async function reconcilePendingForParcel(tx: Db, parcel: Parcel) {
  if (!parcel.feedSource || !parcel.carrier || !parcel.trackingNumber) return;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM FulfillmentEvent WHERE source=${'carrier/'+parcel.feedSource}
    AND json_extract(details,'$.carrier')=${parcel.carrier} AND json_extract(details,'$.trackingNumber')=${parcel.trackingNumber}`;
  const notices = await tx.fulfillmentEvent.findMany({ where: { id: { in: rows.map(row => row.id) } }, orderBy: { occurredAt: 'asc' } });
  for (const notice of notices) await reviewAutomaticMatch(tx, notice, parcel.feedSource, parcel.carrier, parcel.trackingNumber);
}

export async function reviewCarrierMatch(tx: Db, orderId: string, raw: unknown, actor: FulfillmentActor, approved?: string) {
  const input = inputObject(raw);
  const parcelId = requiredText(input.parcelId, '包裹');
  const eventId = requiredText(input.eventId, '承运方通知');
  const parcel = await tx.fulfillmentParcel.findFirst({ where: { id: parcelId, orderId } });
  const event = await tx.fulfillmentEvent.findUnique({ where: { id: eventId } });
  if (!parcel || !event || !event.source.startsWith('carrier/') || !matches(event, parcel)) throw new PurchaseError('本包裹与该物流通知的来源不符');
  const evidence = shipmentEvidence(input);
  if (Date.parse(evidence.occurredAt) < event.occurredAt.getTime()) throw new PurchaseError('人工核对时间不能早于所核对的通知');
  const description = requiredText(input.description, '核对依据');
  const requestId = requiredText(input.requestId, '操作编号');
  const snapshot = { orderId, parcelId, eventId, actorId: actor.id, source: event.source, originalContent: event.contentHash,
    carrier: parcel.carrier, trackingNumber: parcel.trackingNumber, description, ...evidence };
  const keys = parcelKeys('match_carrier', orderId, requestId, { eventId }, snapshot);
  const previous = verifyRepeat(await tx.fulfillmentEvent.findMany({ where: { OR: [{ requestKey: keys.requestKey }, { businessKey: keys.businessKey }] } }), keys);
  if (previous) return confirmPreview(undefined, snapshot);
  if (event.parcelId || event.status !== 'pending') throw new PurchaseError('物流通知已匹配，请核对原记录');
  const candidates = await waybillCandidates(tx, event, parcel.feedSource!, parcel.carrier!, parcel.trackingNumber!);
  const candidateVersion = pricingContentHash(candidates.map(row => row.id));
  const preview = confirmPreview(approved, { ...snapshot, candidateVersion });
  if (approved === undefined) return preview;
  await attach(tx,event,parcel);
  await tx.fulfillmentEvent.create({ data: { ...keys, parcelId, source: 'staff', kind: 'match_carrier', status: 'applied',
    occurredAt: new Date(evidence.occurredAt), reference: evidence.reference, evidenceSha256: evidence.sha256, evidenceRow: evidence.documentRow,
    actorId: actor.id, details: JSON.stringify({ eventId, description, candidateVersion, actionHash: approved }) } });
  return preview;
}
