import type { Prisma } from '@prisma/client';
import { purchaseOperation, type PurchaseActivity, type PurchaseActor } from '@/lib/purchase-activity';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import type { SourceOrder } from '@/lib/purchase-source';
import { documentSha256, positiveCents, PurchaseError, purchaseTimestamp, requiredText } from '@/lib/purchase-terms';

type Db = Prisma.TransactionClient;
type DeliveryAllocation = { purchaseOrderId: string | null; quantity: number };
type Target = { id: string; shipmentId: string | null; orderItemId: string; name: string; quantity: number; occurredAt: string | null; reference: string | null };
type Procurement = { id: string; remaining: Array<{ orderItemId: string; quantity: number }>;
  orderReceipt: { occurredAt: string | null; lines: Array<{ orderItemId: string; quantity: number }> } | null };
type Attribution = { target: Target; sources: DeliveryAllocation[]; occurredAt: string; reference: string; sha256: string; description: string };
export type ShipmentAttributionInput = {
  orderId: string; version: string; requestId: string; actionHash?: string; targetId?: unknown;
  sources?: unknown; occurredAt?: unknown; reference?: unknown; sha256?: unknown; description?: unknown; documentRow?: unknown;
};

function addDelivery(total: Map<string, number>, id: string, quantity: number) {
  total.set(id, (total.get(id) ?? 0) + quantity);
}

function sameShipment(persisted: Target, current: Target) {
  return persisted.id === current.id && persisted.shipmentId === current.shipmentId && persisted.orderItemId === current.orderItemId
    && persisted.quantity === current.quantity && persisted.occurredAt === current.occurredAt;
}

export async function purchaseFulfillmentReview(tx: Db, order: SourceOrder, activities: PurchaseActivity[], purchases: Procurement[]) {
  const rows = await tx.shipmentItem.findMany({ where: { shipment: { orderId: order.id, shippedAt: { not: null },
    status: { in: ['shipped', 'delivered', 'completed'] } } }, include: { shipment: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const actual: Target[] = rows.flatMap(row => {
    const item = order.orderItems.find(item => item.id === row.orderItemId);
    return item && row.shipment.shippedAt && positiveCents(row.quantity) ? [{ id: row.id, shipmentId: row.shipmentId,
      orderItemId: item.id, name: item.name, quantity: row.quantity, occurredAt: row.shipment.shippedAt.toISOString(),
      reference: row.shipment.trackingNumber }] : [];
  });
  const sums = new Map<string, number>();
  for (const row of actual) addDelivery(sums, row.orderItemId, row.quantity);
  const inconsistent = order.orderItems.filter(item => (sums.get(item.id) ?? 0) > item.shippedQty).map(item => item.id);
  const historyBudget = new Map(order.orderItems.map(item => [item.id, Math.max(0, item.shippedQty - (sums.get(item.id) ?? 0))]));
  const ledger = activities.filter(row => row.action === 'attribute_purchase_shipment').map(row => ({
    id: row.id, actorId: row.actorId, recordedAt: row.createdAt, operation: purchaseOperation(row.detail) as unknown as Attribution,
  }));
  const usedHistory = new Map<string, number>();
  const usedShipments = new Set<string>();
  const delivered: Array<{ purchaseOrderId: string; orderItemId: string; quantity: number }> = [];
  for (const row of ledger) {
    const { target, sources } = row.operation;
    if (!target || !Array.isArray(sources) || inconsistent.includes(target.orderItemId)) continue;
    if (target.shipmentId) {
      const shipment = actual.find(line => line.id === target.id);
      if (!shipment || usedShipments.has(target.id) || !sameShipment(target, shipment)) continue;
      usedShipments.add(target.id);
    } else {
      const consumed = usedHistory.get(target.orderItemId) ?? 0;
      if (consumed + target.quantity > (historyBudget.get(target.orderItemId) ?? 0)) continue;
      addDelivery(usedHistory, target.orderItemId, target.quantity);
    }
    for (const source of sources) if (source.purchaseOrderId) delivered.push({ purchaseOrderId: source.purchaseOrderId,
      orderItemId: target.orderItemId, quantity: source.quantity });
  }
  const unassigned = actual.filter(row => !usedShipments.has(row.id) && !inconsistent.includes(row.orderItemId));
  for (const item of order.orderItems) {
    const quantity = (historyBudget.get(item.id) ?? 0) - (usedHistory.get(item.id) ?? 0);
    if (quantity > 0) unassigned.push({ id: `historical:${item.id}`, shipmentId: null, orderItemId: item.id,
      name: item.name, quantity, occurredAt: null, reference: null });
  }
  const targets = unassigned.map(target => ({ ...target, purchaseSources: purchases.flatMap(po => {
    const ordered = po.orderReceipt?.lines.find(row => row.orderItemId === target.orderItemId);
    const remains = po.remaining.find(row => row.orderItemId === target.orderItemId);
    const counted = delivered.reduce((sum, row) => sum + (row.purchaseOrderId === po.id && row.orderItemId === target.orderItemId ? row.quantity : 0), 0);
    const quantity = Math.min(ordered?.quantity ?? 0, remains?.quantity ?? 0) - counted;
    const orderedAt = po.orderReceipt?.occurredAt ?? null;
    return quantity > 0 && (!orderedAt || !target.occurredAt || orderedAt <= target.occurredAt)
      ? [{ purchaseOrderId: po.id, quantity, orderedAt }] : [];
  }) }));
  const state = { targets, delivered, inconsistent, ledger };
  return { ...state, version: pricingContentHash(state) };
}

export function previewShipmentAttribution(orderId: string, state: Awaited<ReturnType<typeof purchaseFulfillmentReview>>, input: ShipmentAttributionInput, actor: PurchaseActor) {
  if (state.version !== input.version) throw new PurchaseError('发货记录或可核对的归属数量已变化，请重新核对');
  const targetId = requiredText(input.targetId, '客户发货行或历史待核对行');
  const row = state.targets.find(target => target.id === targetId);
  if (!row) throw new PurchaseError('该发货行已经关联或当前无法核对');
  const { purchaseSources, ...target } = row;
  const occurredAt = target.occurredAt ?? purchaseTimestamp(input.occurredAt, '历史实际发货时间');
  if (Date.parse(occurredAt) > Date.now()) throw new PurchaseError('历史发货时间不能晚于核对时间');
  if (!Array.isArray(input.sources) || !input.sources.length || input.sources.length > purchaseSources.length + 1) {
    throw new PurchaseError('请逐个填写本次已核实的发货来源', 400);
  }
  const sources = input.sources.map(entry => {
    if (typeof entry !== 'object' || !entry || !positiveCents(entry.quantity)
      || (entry.purchaseOrderId !== null && (typeof entry.purchaseOrderId !== 'string' || !entry.purchaseOrderId.trim()))) {
      throw new PurchaseError('请核对每个发货来源和实际数量', 400);
    }
    const purchaseOrderId = entry.purchaseOrderId as string | null;
    if (purchaseOrderId) {
      const available = purchaseSources.find(source => source.purchaseOrderId === purchaseOrderId);
      if (!available || entry.quantity > available.quantity || (available.orderedAt && available.orderedAt > occurredAt)) {
        throw new PurchaseError('发货归属须对应此前实际订购，且不得超过该采购行剩余可归属数量');
      }
    }
    return { purchaseOrderId, quantity: entry.quantity };
  });
  const attributedQuantity = sources.reduce((sum, source) => sum + source.quantity, 0);
  if (new Set(sources.map(source => source.purchaseOrderId)).size !== sources.length
    || (target.shipmentId ? attributedQuantity !== target.quantity : attributedQuantity > target.quantity)) {
    throw new PurchaseError('各来源归属须符合原发货行或历史待核对数量，同一来源只能填一次');
  }
  const sha256 = documentSha256(input.sha256, '发货来源书证摘要');
  const documentRow = target.shipmentId ? null : input.documentRow;
  if (!target.shipmentId && !positiveCents(documentRow)) throw new PurchaseError('请填写历史书证中对应发货记录的行序号', 400);
  const operation = { target: { ...target, quantity: attributedQuantity }, sources, occurredAt, sha256, documentRow,
    reference: requiredText(input.reference, '发货来源书面凭据档案'), description: requiredText(input.description, '发货归属核对结果') };
  const referenceKey = target.shipmentId ? pricingContentHash({ purpose: 'purchase_shipment_attribution', shipmentItemId: target.id })
    : pricingContentHash({ purpose: 'purchase_shipment_archive', sha256, documentRow });
  const snapshot = { orderId, actor, requestId: input.requestId, version: input.version, operation, referenceKey };
  return { snapshot, actionHash: pricingContentHash(snapshot) };
}
