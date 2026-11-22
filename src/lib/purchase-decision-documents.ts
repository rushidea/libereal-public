import { Prisma } from '@prisma/client';
import { purchaseObject, purchaseOperation } from '@/lib/purchase-activity';
import { positiveCents, PurchaseError, requiredText, type PurchaseTerms } from '@/lib/purchase-terms';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';

type Db = Prisma.TransactionClient;
const parties = ['supplier','customer'] as const;
type Party = typeof parties[number];

type Subject = { orderId: string; purchaseOrderId: string; orderItemId: string; shortfallId?: string };
export type DecisionCoverage = Subject & { quantity: number };
export type LegacyDecisionLocation = { activityId: string; orderItemId: string; row: number; quantity: number };
export type DecisionDocumentInput = {
  supplierDocumentRow?: number; customerDocumentRow?: number;
  supplierDocumentScope?: DecisionCoverage[]; customerDocumentScope?: DecisionCoverage[];
  supplierRestoreScope?: boolean; customerRestoreScope?: boolean;
  supplierLegacyLocations?: LegacyDecisionLocation[]; customerLegacyLocations?: LegacyDecisionLocation[];
};
type Purpose = 'free_resend' | 'supplier_facts' | 'new_purchase' | 'amend_contract' | 'amend_and_replace' | 'cancel_unshipped' | 'replace_unshipped'
  | 'reduce_contract' | 'continue_contract' | 'decline_preparation' | 'reconfirm_terms';
export type DecisionEffect = {
  orderItemId: string; quantity: number; shortfallId?: string; shortfallDecision?: string; forwardingLossId?: string; outcome: string; document?: DecisionDocumentInput;
  replacement?: { terms: PurchaseTerms; source: { brand?: string | null; catalogNumber?: string | null; spec?: string | null; unit?: string | null; quantity: number } } | null;
};

export function decisionMaterialTerms(replacement: NonNullable<DecisionEffect['replacement']>) {
  const { source, terms } = replacement;
  const { supplier,writtenSupplier,payee,unitPriceCents,currency,taxBasis,freightTerms,paymentTerms,leadTime,validUntil,supplierConditions } = terms;
  let adjustment;
  if (positiveCents(terms.linePayableCents) && positiveCents(source.quantity) && terms.linePayableCents !== (unitPriceCents ?? 0)*source.quantity) {
    let a = terms.linePayableCents;
    let b = source.quantity;
    while (b) [a,b] = [b,a % b];
    adjustment = { total: terms.linePayableCents/a, units: source.quantity/a, basis: terms.amountBreakdown };
  }
  return { brand: source.brand, catalogNumber: source.catalogNumber, spec: source.spec, unit: source.unit,
    supplier,writtenSupplier,payee,unitPriceCents,currency,taxBasis,freightTerms,paymentTerms,leadTime,validUntil,supplierConditions,adjustment };
}
export function decisionTermsChanged(source: NonNullable<DecisionEffect['replacement']>['source'], before: PurchaseTerms, after: PurchaseTerms) {
  return !sameVersion(decisionMaterialTerms({source,terms:before}),decisionMaterialTerms({source,terms:after}));
}

type Authority = { purpose: Purpose; alternate?: ReturnType<typeof decisionMaterialTerms> };
function authorityForParty(role: Party, authority: Authority | undefined) {
  if (role !== 'supplier' || !authority) return authority;
  return ['amend_contract','amend_and_replace','cancel_unshipped','replace_unshipped'].includes(authority.purpose)
    ? { purpose:'reduce_contract' as const } : authority;
}

function commercialAuthority(role: Party, line: DecisionEffect): Authority {
  if (line.outcome === 'continue_contract' || line.outcome === 'decline_preparation') return { purpose:line.outcome };
  let purpose: Purpose;
  switch (line.shortfallDecision ?? (line.forwardingLossId ? 'new_purchase' : undefined)) {
    case 'free_resend': purpose = 'free_resend'; break;
    case 'new_purchase': purpose = role === 'supplier' ? 'supplier_facts' : 'new_purchase'; break;
    case 'change_contract': purpose = line.replacement ? 'amend_and_replace' : 'amend_contract'; break;
    default: purpose = line.outcome === 'reconfirm_terms' ? 'reconfirm_terms' : line.outcome === 'replace' ? 'replace_unshipped' : 'cancel_unshipped';
  }
  const authority = role === 'customer' && line.replacement ? { purpose, alternate: decisionMaterialTerms(line.replacement) } : { purpose };
  return authorityForParty(role,authority)!;
}
type DocumentUse = { role: Party; sha256: string; row?: number; coverage: DecisionCoverage[]; allocations: DecisionCoverage[];
  scopeConfirmed: boolean; authority: Authority; legacyLocations?: LegacyDecisionLocation[] };
type PriorUse = {
  role: Party; sha256: string; row?: number; coverage?: DecisionCoverage[];
  allocations: DecisionCoverage[]; activityId: string; authority?: Authority; unlocated?: boolean; legacyLocations?: LegacyDecisionLocation[];
};
type RequestedUse = Omit<DocumentUse,'coverage' | 'scopeConfirmed' | 'legacyLocations'>
  & { coverage?: DecisionCoverage[]; restore: boolean; legacyLocations: LegacyDecisionLocation[] };

const label = (role: Party) => role === 'supplier' ? '供方书证' : '客户书证';
const digestField = (role: Party) => role === 'supplier' ? 'supplierSha256' : 'customerSha256';
const rowField = (role: Party) => role === 'supplier' ? 'supplierDocumentRow' : 'customerDocumentRow';
const scopeField = (role: Party) => role === 'supplier' ? 'supplierDocumentScope' : 'customerDocumentScope';
const restoreField = (role: Party) => role === 'supplier' ? 'supplierRestoreScope' : 'customerRestoreScope';
const legacyField = (role: Party) => role === 'supplier' ? 'supplierLegacyLocations' : 'customerLegacyLocations';
const locationKey = ({activityId,orderItemId}: Pick<LegacyDecisionLocation,'activityId' | 'orderItemId'>) => JSON.stringify([activityId,orderItemId]);
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

function sameVersion(a: object, b: object) {
  return pricingContentHash(a) === pricingContentHash(b);
}

function readLocations(value: unknown): LegacyDecisionLocation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.length) throw new PurchaseError('请填写旧批准实际对应的原件行',400);
  return value.map(raw => {
    const entry = purchaseObject(raw);
    const row = decisionDocumentRow(entry.row);
    if (!row || !positiveCents(entry.quantity)) throw new PurchaseError('请核对旧批准实际占用的原件行和数量',400);
    return { activityId: requiredText(entry.activityId,'旧批准编号'), orderItemId: requiredText(entry.orderItemId,'旧批准的商品行'),
      row, quantity: entry.quantity };
  });
}

function historicalRevisions(
  record: { id: string; orderId: string; purchaseOrderId: string },
  snapshot: Record<string,unknown>,
  operation: Record<string,unknown>,
): PriorUse[] {
  if (operation.outcome !== 'revised_terms' || typeof operation.customerSha256 !== 'string'
    || !Array.isArray(snapshot.lines) || !Array.isArray(operation.revisedTerms)) return [];
  const revisions = operation.revisedTerms as Array<{ orderItemId: string; terms: PurchaseTerms }>;
  const lines = snapshot.lines as Array<NonNullable<DecisionEffect['replacement']> & { orderItemId: string; fromPurchaseOrderId?: string }>;
  return revisions.flatMap(edit => {
    const prior = lines.find(line => line.orderItemId === edit.orderItemId);
    if (!prior?.fromPurchaseOrderId || !positiveCents(prior.source?.quantity) || !decisionTermsChanged(prior.source,prior.terms,edit.terms)) return [];
    const target = { orderId:record.orderId,purchaseOrderId:record.purchaseOrderId,orderItemId:edit.orderItemId,quantity:prior.source.quantity };
    const authority = commercialAuthority('customer',{ ...target,outcome:'reconfirm_terms',replacement:{ source:prior.source,terms:edit.terms } });
    return [{ role:'customer',sha256:operation.customerSha256 as string,activityId:record.id,unlocated:true,authority,allocations:[target] }];
  });
}

async function priorUses(tx: Db, digests: string[]) {
  const rows = await tx.$queryRaw<Array<{ id: string; orderId: string; purchaseOrderId: string; detail: string }>>`
    SELECT id,orderId,purchaseOrderId,detail FROM PurchaseActivity WHERE action='resolve_change'
      AND (json_extract(detail,'$.snapshot.operation.supplierSha256') IN (${Prisma.join(digests)})
        OR json_extract(detail,'$.snapshot.operation.customerSha256') IN (${Prisma.join(digests)})) ORDER BY rowid`;
  return rows.flatMap(record => {
    const detail = purchaseObject(JSON.parse(record.detail));
    const operation = purchaseOperation(detail);
    const dispositions = Array.isArray(operation.dispositions) ? operation.dispositions as DecisionEffect[] : undefined;
    if (Array.isArray(operation.decisionDocuments)) return (operation.decisionDocuments as DocumentUse[]).map(document => {
      const effects = document.allocations.map(allocation => dispositions?.find(line => line.orderItemId === allocation.orderItemId));
      const first = effects[0] && commercialAuthority(document.role,effects[0]);
      const inferred = first && effects.every(line => line && sameVersion(first,commercialAuthority(document.role,line))) ? first : undefined;
      return { ...document, authority: authorityForParty(document.role,document.authority) ?? inferred,
        coverage: document.scopeConfirmed ? document.coverage : undefined, activityId: record.id };
    });
    if (!dispositions) {
      const locatedChanges = historicalRevisions(record,purchaseObject(detail.snapshot),operation);
      if (locatedChanges.length) return locatedChanges;
      const knownPurpose = operation.outcome === 'original_terms' ? 'continue_contract' : operation.outcome === 'declined' ? 'decline_preparation'
        : operation.outcome === 'revised_terms' ? 'reconfirm_terms' : undefined;
      return !knownPurpose ? [] : parties.flatMap(role => {
        const sha256 = operation[digestField(role)];
        return typeof sha256 === 'string' ? [{ role, sha256, activityId:record.id, authority:{ purpose:knownPurpose }, allocations:[] }] : [];
      });
    }
    return parties.flatMap(role => {
      const sha256 = operation[digestField(role)];
      if (typeof sha256 !== 'string' || !digests.includes(sha256)) return [];
      return dispositions.flatMap((raw: unknown): PriorUse[] => {
        const action = purchaseObject(raw);
        if (!positiveCents(action.quantity) || typeof action.orderItemId !== 'string') return [];
        const shortfallId = action.shortfallId ?? action.forwardingLossId;
        const row = action[rowField(role)];
        return [{ role, sha256, ...(positiveCents(row) ? { row } : { unlocated: true }), activityId: record.id,
          authority: commercialAuthority(role,raw as DecisionEffect),
          allocations: [{ orderId: record.orderId, purchaseOrderId: record.purchaseOrderId, orderItemId: action.orderItemId,
            ...(typeof shortfallId === 'string' ? { shortfallId } : {}), quantity: action.quantity }] }];
      });
    });
  }) as PriorUse[];
}

function locatePriorUses(history: PriorUse[], locations: LegacyDecisionLocation[]) {
  const found = new Map<string,LegacyDecisionLocation[]>();
  const add = (entry: LegacyDecisionLocation) => {
    const key = locationKey(entry);
    found.set(key,[...(found.get(key) ?? []),entry]);
  };
  for (const use of history) for (const entry of use.legacyLocations ?? []) add(entry);

  const recorded = new Map(history.filter(row => row.unlocated).flatMap(use => use.allocations.map(allocation => [
    locationKey({activityId:use.activityId,orderItemId:allocation.orderItemId}),allocation,
  ] as const)));
  const added = new Map<string,LegacyDecisionLocation[]>();
  for (const entry of locations) {
    const key = locationKey(entry);
    const current = added.get(key) ?? [];
    if (!recorded.has(key) || found.has(key) || current.some(row => row.row === entry.row)) {
      throw new PurchaseError('该旧批准或商品行已核对，或无法对应这份原件');
    }
    added.set(key,[...current,entry]);
  }
  for (const [key,entries] of added) {
    if (entries.reduce((sum,row) => sum+row.quantity,0) !== recorded.get(key)!.quantity) {
      throw new PurchaseError('补记的原件行数量须与旧批准实际占用量一致');
    }
    found.set(key,entries);
  }
  return history.flatMap(use => !use.unlocated ? [use] : use.allocations.flatMap(allocation => {
    const resolved = found.get(locationKey({activityId:use.activityId,orderItemId:allocation.orderItemId}));
    return resolved ? resolved.map(entry => ({ ...use, row: entry.row, unlocated:false,
      allocations:[{ ...allocation, quantity:entry.quantity }] }))
      : [{ ...use, allocations:[allocation] }];
  }));
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
  orderId: string; purchaseOrderId: string; supplierSha256?: string; customerSha256?: string;
  effects: DecisionEffect[];
  documents: Array<DecisionDocumentInput & { orderItemId: string }>;
}) {
  if (!Array.isArray(input.documents) || input.documents.some(row => !row || typeof row.orderItemId !== 'string')
    || new Set(input.documents.map(row => row.orderItemId)).size !== input.documents.length) {
    throw new PurchaseError('请逐行填写书证原件范围', 400);
  }
  const requested = new Map<string,RequestedUse>();
  for (const use of input.effects) {
    const selected = use.document ?? input.documents.find(row => row.orderItemId === use.orderItemId);
    const {orderId,purchaseOrderId} = input;
    const allocation = { orderId, purchaseOrderId, orderItemId: use.orderItemId, ...(use.shortfallId ? { shortfallId: use.shortfallId } : {}), quantity: use.quantity };
    for (const role of parties) {
      const sha256 = input[digestField(role)];
      if (!sha256) continue;
      const row = decisionDocumentRow(selected?.[rowField(role)]);
      const coverage = normalizeCoverage(selected?.[scopeField(role)]);
      const restore = selected?.[restoreField(role)] === true;
      const legacyLocations = readLocations(selected?.[legacyField(role)]);
      if (((coverage || legacyLocations.length) && !row) || (restore && !coverage)) {
        throw new PurchaseError('分次使用或补录范围时，须核对原件行号与明确的覆盖数量',400);
      }
      const current = { role, sha256, row, coverage, restore, legacyLocations,
        authority: commercialAuthority(role,use), allocations: [allocation] };
      const key = documentKey(current);
      const previous = requested.get(key);
      if (!previous) requested.set(key,current);
      else {
        if (!sameVersion(previous.authority,current.authority)) throw new PurchaseError('同一原件行的商业决定或适用条件不一致，请重新核证');
        if (previous.coverage && coverage && !sameVersion(previous.coverage,coverage)) {
          throw new PurchaseError('同一原件行须使用同一份经核对的覆盖范围');
        }
        previous.coverage ??= coverage;
        previous.restore ||= restore;
        previous.legacyLocations.push(...legacyLocations);
        previous.allocations.push(allocation);
      }
    }
  }
  if (!requested.size) return [];
  const history = await priorUses(tx,[...new Set([...requested.values()].map(row => row.sha256))]);
  const result = [];
  for (const current of requested.values()) {
    const sameFile = (row: Pick<DocumentUse,'role' | 'sha256' | 'row'>) => row.role === current.role && row.sha256 === current.sha256;
    const currentDocuments = [...requested.values()].filter(sameFile);
    const added = currentDocuments.flatMap(row => row.legacyLocations);
    const existing = locatePriorUses(history.filter(sameFile),added);
    const currentOverlap = currentDocuments.some(row => row !== current && (row.row === undefined || current.row === undefined));
    const historicalOverlap = existing.filter(row => row.row !== current.row && (row.row === undefined || current.row === undefined));
    if (currentOverlap || historicalOverlap.some(row => !row.unlocated)) {
      throw new PurchaseError(label(current.role)+'整份已占用，请核对原件中尚未使用的独立行');
    }
    if (historicalOverlap.length) throw new PurchaseError(label(current.role)+'有未定位的旧批准，请先核对该批准实际占用的原件行和数量');
    const matched = existing.filter(row => row.row === current.row);
    if (matched.some(row => !row.authority || !sameVersion(row.authority,current.authority))) {
      const fresh = current.role === 'supplier' ? '新的供应商书面决定' : '客户新的书面同意';
      throw new PurchaseError(label(current.role)+'的商业决定、供方或实质条件已变化，请核对'+fresh+'或尚未使用的独立行');
    }
    const verified = matched.find(row => row.coverage)?.coverage;
    if (verified && current.coverage && !sameVersion(verified,current.coverage)) {
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
      scopeConfirmed: Boolean(verified || current.coverage), authority: current.authority,
      ...(current.legacyLocations.length ? { legacyLocations: current.legacyLocations } : {}),
      ...(restoring ? { restoredActivityIds: [...new Set(matched.map(row => row.activityId))] } : {}) });
  }
  return result;
}
