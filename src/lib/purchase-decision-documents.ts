import { Prisma } from '@prisma/client';
import { purchaseObject, purchaseOperation } from '@/lib/purchase-activity';
import { positiveCents, PurchaseError, requiredText } from '@/lib/purchase-terms';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';

type Db = Prisma.TransactionClient;
const parties = ['supplier','customer'] as const;
type Party = typeof parties[number];

type Subject = { orderId: string; purchaseOrderId: string; orderItemId: string; shortfallId?: string };
export type DecisionCoverage = Subject & { quantity: number };
export type DecisionDocumentInput = {
  supplierDocumentRow?: number; customerDocumentRow?: number;
  supplierDocumentScope?: DecisionCoverage[]; customerDocumentScope?: DecisionCoverage[];
  supplierRestoreScope?: boolean; customerRestoreScope?: boolean;
};
type DocumentUse = { role: Party; sha256: string; row?: number; coverage: DecisionCoverage[]; allocations: DecisionCoverage[];
  scopeConfirmed: boolean };
type PriorUse = {
  role: Party; sha256: string; row?: number; coverage?: DecisionCoverage[];
  allocations: DecisionCoverage[]; activityId: string;
};
type RequestedUse = Omit<DocumentUse,'coverage' | 'scopeConfirmed'> & { coverage?: DecisionCoverage[]; restore: boolean };

const label = (role: Party) => role === 'supplier' ? '供方书证' : '客户书证';
const digestField = (role: Party) => role === 'supplier' ? 'supplierSha256' : 'customerSha256';
const rowField = (role: Party) => role === 'supplier' ? 'supplierDocumentRow' : 'customerDocumentRow';
const scopeField = (role: Party) => role === 'supplier' ? 'supplierDocumentScope' : 'customerDocumentScope';
const restoreField = (role: Party) => role === 'supplier' ? 'supplierRestoreScope' : 'customerRestoreScope';
const subjectKey = ({orderId,purchaseOrderId,orderItemId,shortfallId}: Subject) =>
  JSON.stringify([orderId,purchaseOrderId,orderItemId,shortfallId ?? null]);
const documentKey = ({role,sha256,row}: Pick<DocumentUse,'role' | 'sha256' | 'row'>) => JSON.stringify([role,sha256,row ?? null]);

function sameSubject(scope: Subject, allocation: Subject) {
  return scope.orderId === allocation.orderId && scope.purchaseOrderId === allocation.purchaseOrderId && scope.orderItemId === allocation.orderItemId
    && (!scope.shortfallId || scope.shortfallId === allocation.shortfallId);
}

export function decisionDocumentRow(value: unknown) {
  if (value == null) return undefined;
  if (!positiveCents(value)) throw new PurchaseError('书面决定的行号须为原件所载的正整数', 400);
  return value;
}

function normalizeCoverage(value: unknown) {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.length) throw new PurchaseError('请填写原件明确覆盖的采购行与数量', 400);
  const coverage = value.map(raw => {
    const source = purchaseObject(raw);
    if (!positiveCents(source.quantity)) throw new PurchaseError('书面核准数量须为正整数',400);
    return { orderId: requiredText(source.orderId,'书证对应的客户订单'), purchaseOrderId: requiredText(source.purchaseOrderId,'书证对应的采购单'),
      orderItemId: requiredText(source.orderItemId,'书证对应的客户商品行'),
      ...(source.shortfallId ? { shortfallId: requiredText(source.shortfallId,'书证对应的物流短失') } : {}), quantity: source.quantity };
  }).sort((a,b) => subjectKey(a).localeCompare(subjectKey(b)));
  if (coverage.some((scope,index) => coverage.slice(index+1).some(other => sameSubject(scope,other) || sameSubject(other,scope)))) {
    throw new PurchaseError('原件覆盖范围中的同一采购行数量不得重复', 400);
  }
  return coverage;
}

function sameCoverage(a: DecisionCoverage[], b: DecisionCoverage[]) {
  return pricingContentHash(a) === pricingContentHash(b);
}

async function priorUses(tx: Db, digests: string[]) {
  const rows = await tx.$queryRaw<Array<{ id: string; orderId: string; purchaseOrderId: string; detail: string }>>`
    SELECT id,orderId,purchaseOrderId,detail FROM PurchaseActivity WHERE action='resolve_change'
      AND (json_extract(detail,'$.snapshot.operation.supplierSha256') IN (${Prisma.join(digests)})
        OR json_extract(detail,'$.snapshot.operation.customerSha256') IN (${Prisma.join(digests)})) ORDER BY rowid`;
  return rows.flatMap(record => {
    const operation = purchaseOperation(JSON.parse(record.detail));
    if (Array.isArray(operation.decisionDocuments)) return (operation.decisionDocuments as DocumentUse[])
      .map(document => ({ ...document, coverage: document.scopeConfirmed ? document.coverage : undefined, activityId: record.id }));
    const dispositions = operation.dispositions;
    if (!Array.isArray(dispositions)) return [];
    return parties.flatMap(role => {
      const sha256 = operation[digestField(role)];
      if (typeof sha256 !== 'string' || !digests.includes(sha256)) return [];
      return dispositions.flatMap((raw: unknown): PriorUse[] => {
        const action = purchaseObject(raw);
        if (!positiveCents(action.quantity) || typeof action.orderItemId !== 'string') return [];
        const shortfallId = action.shortfallId ?? action.forwardingLossId;
        const row = action[rowField(role)];
        return [{ role, sha256, ...(positiveCents(row) ? { row } : {}), activityId: record.id,
          allocations: [{ orderId: record.orderId, purchaseOrderId: record.purchaseOrderId, orderItemId: action.orderItemId,
            ...(typeof shortfallId === 'string' ? { shortfallId } : {}), quantity: action.quantity }] }];
      });
    });
  }) as PriorUse[];
}

async function verifyCoverage(tx: Db, coverage: DecisionCoverage[]) {
  for (const entry of coverage) {
    const original = await tx.purchaseRequirement.findUnique({
      where: { orderItemId: entry.orderItemId, orderId: entry.orderId, purchaseOrderId: entry.purchaseOrderId },
      select: { source: true, orderItem: { select: { quantity: true } } },
    });
    const substitute = original ? null : await tx.purchaseReplacementLine.findUnique({
      where: { purchaseOrderId_orderItemId: { purchaseOrderId: entry.purchaseOrderId, orderItemId: entry.orderItemId }, orderId: entry.orderId },
      select: { quantity: true },
    });
    const quantity = original ? Math.min(Number(purchaseObject(JSON.parse(original.source)).quantity),original.orderItem.quantity) : substitute?.quantity;
    if (!positiveCents(quantity) || entry.quantity > quantity) throw new PurchaseError('书证覆盖范围须对应实际客户订单、采购行和数量');
    if (entry.shortfallId) {
      const loss = await tx.fulfillmentLineResolution.findUnique({ where: { id: entry.shortfallId }, select: {
        quantity: true, parcelLine: { select: { purchaseOrderId: true, orderItemId: true, parcel: { select: { orderId: true } } } },
      } });
      if (!loss || loss.quantity < entry.quantity || !sameSubject(entry,{
        orderId: loss.parcelLine.parcel.orderId, purchaseOrderId: loss.parcelLine.purchaseOrderId ?? '',
        orderItemId: loss.parcelLine.orderItemId, shortfallId: entry.shortfallId,
      })) throw new PurchaseError('书证覆盖范围须对应实际物流短失的原行和数量');
    }
  }
}

export async function previewDecisionDocuments(tx: Db, input: {
  orderId: string; purchaseOrderId: string; supplierSha256: string; customerSha256: string;
  dispositions: Array<{ orderItemId: string; shortfallId?: string; quantity: number }>;
  documents: Array<DecisionDocumentInput & { orderItemId: string }>;
}) {
  const requested = new Map<string,RequestedUse>();
  for (const use of input.dispositions) {
    const selected = input.documents.find(row => row.orderItemId === use.orderItemId)!;
    const {orderId,purchaseOrderId} = input;
    const allocation = { orderId, purchaseOrderId, orderItemId: use.orderItemId, ...(use.shortfallId ? { shortfallId: use.shortfallId } : {}), quantity: use.quantity };
    for (const role of parties) {
      const row = decisionDocumentRow(selected[rowField(role)]);
      const coverage = normalizeCoverage(selected[scopeField(role)]);
      const restore = selected[restoreField(role)] === true;
      if ((coverage && !row) || (restore && !coverage)) throw new PurchaseError('分次使用或补录范围时，须核对原件行号与明确的覆盖数量',400);
      const current = { role, sha256: input[digestField(role)], row, coverage, restore, allocations: [allocation] };
      const key = documentKey(current);
      const previous = requested.get(key);
      if (!previous) requested.set(key,current);
      else {
        if (previous.coverage && coverage && !sameCoverage(previous.coverage,coverage)) {
          throw new PurchaseError('同一原件行须使用同一份经核对的覆盖范围');
        }
        previous.coverage ??= coverage;
        previous.restore ||= restore;
        previous.allocations.push(allocation);
      }
    }
  }
  const history = await priorUses(tx,[...new Set([...requested.values()].map(row => row.sha256))]);
  const result = [];
  for (const current of requested.values()) {
    const existing = history.filter(row => row.role === current.role && row.sha256 === current.sha256);
    const sameFile = (row: Pick<DocumentUse,'role' | 'sha256' | 'row'>) => row.role === current.role && row.sha256 === current.sha256;
    const currentOverlap = [...requested.values()].some(row => row !== current && sameFile(row) && (row.row === undefined || current.row === undefined));
    const historicalOverlap = existing.some(row => row.row !== current.row && (row.row === undefined || current.row === undefined));
    if (currentOverlap || historicalOverlap) throw new PurchaseError(label(current.role)+'整份已占用，请核对原件中尚未使用的独立行');
    const matched = existing.filter(row => row.row === current.row);
    const verified = matched.find(row => row.coverage)?.coverage;
    if (verified && current.coverage && !sameCoverage(verified,current.coverage)) {
      throw new PurchaseError(label(current.role)+'已核准的覆盖范围发生冲突，请核对原件及既有批准');
    }
    const restoring = !verified && matched.length > 0;
    if (restoring && (!current.restore || !current.coverage || current.row === undefined)) {
      throw new PurchaseError(label(current.role)+'已使用。请核对新的供应商书面决定和客户同意，或补记原件中尚未使用的独立行及明确范围');
    }
    if (current.restore && !restoring && !verified) throw new PurchaseError(label(current.role)+'没有可接续的旧原件行使用记录');
    const coverage = verified ?? current.coverage ?? current.allocations;
    if (!verified && current.coverage) await verifyCoverage(tx,coverage);
    const counted = matched.flatMap(row => row.allocations);
    const all = [...counted,...current.allocations];
    if (all.some(used => !coverage.some(scope => sameSubject(scope,used)))) {
      throw new PurchaseError(label(current.role)+'明确覆盖的订单、采购单或商品行不包含本次办理对象');
    }
    const balances = coverage.map(scope => {
      const usedBefore = counted.filter(row => sameSubject(scope,row)).reduce((sum,row) => sum+row.quantity,0);
      const using = current.allocations.filter(row => sameSubject(scope,row)).reduce((sum,row) => sum+row.quantity,0);
      const remaining = scope.quantity-usedBefore-using;
      if (remaining < 0) throw new PurchaseError(label(current.role)+'已用或本次处理数量超过原件核准范围，请核对尚未使用的独立行或数量');
      return { ...scope, usedBefore, using, remaining };
    });
    result.push({ role: current.role, sha256: current.sha256, row: current.row, coverage, allocations: current.allocations, balances,
      scopeConfirmed: Boolean(verified || current.coverage),
      ...(restoring ? { restoredActivityIds: [...new Set(matched.map(row => row.activityId))] } : {}) });
  }
  return result;
}
