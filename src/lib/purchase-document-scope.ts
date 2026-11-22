import type { Prisma } from '@prisma/client';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { addPurchaseActivity, purchaseObject, type PurchaseActivity, type PurchaseActor } from '@/lib/purchase-activity';
import type { PurchaseSource } from '@/lib/purchase-source';
import { documentSha256, positiveCents, PurchaseError, type PurchaseTerms } from '@/lib/purchase-terms';

type Db = Prisma.TransactionClient;
type SupplyLine = { source: PurchaseSource; terms: PurchaseTerms };

function documentLine({ source, terms }: SupplyLine) {
  return { sha256: terms.sourceSha256, kind: terms.sourceDocumentKind ?? 'single_item', row: terms.sourceDocumentRow ?? 1,
    goods: { name: source.name, brand: source.brand, catalogNumber: source.catalogNumber, spec: source.spec, unit: source.unit, quantity: source.quantity },
    offer: { writtenSupplier: terms.writtenSupplier, unitPriceCents: terms.unitPriceCents, currency: terms.currency, taxBasis: terms.taxBasis,
      freightTerms: terms.freightTerms, leadTime: terms.leadTime, validUntil: terms.validUntil, supplierConditions: terms.supplierConditions } };
}

type Scope = ReturnType<typeof documentLine>;

function sameOffer(left: Scope, right: Scope) {
  return left.sha256 === right.sha256 && pricingContentHash({ goods: left.goods, offer: left.offer }) === pricingContentHash({ goods: right.goods, offer: right.offer });
}

function previouslyCheckedScope(previous: Scope[], intended: Scope) {
  const matches = previous.filter(row => sameOffer(row, intended));
  return matches.length === 1 ? matches[0] : undefined;
}

export function agreedDocumentTerms(line: SupplyLine, ledger: PurchaseActivity[]) {
  if (line.terms.sourceDocumentKind || !line.terms.sourceSha256 || line.source.written?.replyHash === line.terms.sourceSha256) return line.terms;
  const known = previouslyCheckedScope(ledger.filter(row => row.action === 'review_supplier_document_scope' && row.orderItemId === line.source.orderItemId)
    .map(row => row.detail.document as Scope), documentLine(line));
  return known ? { ...line.terms, sourceDocumentKind: known.kind, sourceDocumentRow: known.kind === 'multiple_items' ? known.row : undefined } : line.terms;
}

export function missingDocumentScopes(lines: SupplyLine[]) {
  return lines.flatMap(line => line.terms.sourceSha256 && !line.terms.sourceDocumentKind && line.source.written?.replyHash !== line.terms.sourceSha256
    ? [{ orderItemId: line.source.orderItemId, sha256: line.terms.sourceSha256, reference: line.terms.sourceReference }] : []);
}

export function restoreDocumentScopes<Line extends SupplyLine>(lines: Line[], input: unknown) {
  const missing = missingDocumentScopes(lines);
  if (!missing.length && input === undefined) return lines;
  if (!Array.isArray(input) || input.length !== missing.length || new Set(input.map(row => row?.orderItemId)).size !== missing.length) {
    throw new PurchaseError('请逐行核对旧供货书证的原件摘要和对应商品行');
  }
  const rows = new Set<string>();
  return lines.map(line => {
    const old = missing.find(row => row.orderItemId === line.source.orderItemId);
    if (!old) return line;
    const entry = input.find(row => row?.orderItemId === old.orderItemId);
    if (!entry || documentSha256(entry.sha256, '旧供货原件摘要') !== old.sha256
      || (entry.kind !== 'single_item' && entry.kind !== 'multiple_items')) throw new PurchaseError('补记范围须对应原批准所用的同一供货文件');
    const row = entry.kind === 'multiple_items' ? entry.row : 1;
    if (!positiveCents(row) || (entry.kind === 'single_item' && entry.row != null && entry.row !== 1)) throw new PurchaseError('请填写供货文件中实际对应的商品行');
    const key = `${old.sha256}:${row}`;
    if (rows.has(key)) throw new PurchaseError('不同采购行须对应原件中各自的报价行');
    rows.add(key);
    return { ...line, terms: { ...line.terms, sourceDocumentKind: entry.kind as PurchaseTerms['sourceDocumentKind'],
      sourceDocumentRow: entry.kind === 'multiple_items' ? row : undefined } };
  });
}

function compareScope(known: Scope, intended: Scope) {
  if (known.kind !== intended.kind || (known.row === intended.row && pricingContentHash(known) !== pricingContentHash(intended))) {
    throw new PurchaseError('该供货书证行已对应其他商品、数量或条款，请核对涵盖本行的报价');
  }
}

export async function assertSupplierDocumentScopes(tx: Db, lines: SupplyLine[], options?: {
  attestation?: { orderId: string; purchaseOrderId?: string; actor: PurchaseActor }; restoredLines?: SupplyLine[];
}) {
  const checked: Scope[] = [];
  for (const line of lines) {
    const intended = documentLine(line);
    if (!intended.sha256) continue;
    for (const known of checked) if (known.sha256 === intended.sha256) compareScope(known, intended);
    checked.push(intended);

    const [native] = await tx.$queryRaw<{ payload: string }[]>`
      SELECT payload FROM BackgroundTask WHERE type='inquiry.supplier_written_quote' AND status='succeeded'
        AND json_extract(result,'$.replyHash')=${intended.sha256} LIMIT 1`;
    if (native) {
      const scope = purchaseObject(jsonObject(native.payload).scope);
      if (line.source.written?.replyHash !== intended.sha256 || intended.kind !== 'single_item'
        || scope.quantity !== line.source.quantity || scope.catalogNumber !== line.source.catalogNumber) {
        throw new PurchaseError('原供应商回函只涵盖已核准的原品牌、货号、规格及数量');
      }
    }
    const receipts = await tx.$queryRaw<{ detail: string }[]>`
      SELECT detail FROM PurchaseActivity WHERE action='review_supplier_document_scope'
        AND json_extract(detail,'$.document.sha256')=${intended.sha256}`;
    const previous = receipts.map(row => jsonObject(row.detail).document as Scope);
    const legacy = await tx.$queryRaw<{ source: string; terms: string }[]>`
      SELECT r.source,r.terms FROM PurchaseRequirement r JOIN PurchaseOrder p ON p.id=r.purchaseOrderId
      WHERE p.approvedHash IS NOT NULL AND json_extract(r.terms,'$.sourceSha256')=${intended.sha256}
        AND json_type(r.terms,'$.verification')='object'
      UNION ALL SELECT r.source,r.terms FROM PurchaseReplacementLine r JOIN PurchaseOrder p ON p.id=r.purchaseOrderId
      WHERE p.approvedHash IS NOT NULL AND json_extract(r.terms,'$.sourceSha256')=${intended.sha256}
        AND json_type(r.terms,'$.verification')='object'`;
    for (const known of previous) compareScope(known, intended);
    const alreadyVerified = previous.some(row => row.row === intended.row);
    // The original file can establish this line's scope while other archived lines await their own review.
    const restoring = options?.restoredLines?.some(row => row.source.orderItemId === line.source.orderItemId && row.terms.sourceSha256 === intended.sha256);
    for (const row of legacy) {
      const historical: SupplyLine = { source: JSON.parse(row.source), terms: JSON.parse(row.terms) };
      if (historical.terms.sourceDocumentKind || (native && historical.source.written?.replyHash === intended.sha256)) {
        compareScope(documentLine(historical), intended);
      } else if (!restoring && !alreadyVerified) {
        throw new PurchaseError('旧供货书证须先以原件逐行核对适用的商品和数量');
      }
    }
    const attestation = options?.attestation;
    if (attestation && !alreadyVerified) {
      await addPurchaseActivity(tx, { orderId: attestation.orderId, purchaseOrderId: attestation.purchaseOrderId, orderItemId: line.source.orderItemId,
        actor: attestation.actor, action: 'review_supplier_document_scope',
        referenceKey: pricingContentHash({ purpose: 'supplier_document_row', sha256: intended.sha256, row: intended.row }),
        detail: { document: intended, reference: line.terms.sourceReference } });
    }
  }
}
