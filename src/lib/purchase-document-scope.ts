import type { Prisma } from '@prisma/client';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { addPurchaseActivity, purchaseObject, type PurchaseActor } from '@/lib/purchase-activity';
import type { PurchaseSource } from '@/lib/purchase-source';
import { PurchaseError, type PurchaseTerms } from '@/lib/purchase-terms';

type Db = Prisma.TransactionClient;
type SupplyLine = { source: PurchaseSource; terms: PurchaseTerms };

function documentLine({ source, terms }: SupplyLine) {
  return { sha256: terms.sourceSha256, kind: terms.sourceDocumentKind ?? 'single_item', row: terms.sourceDocumentRow ?? 1,
    goods: { name: source.name, brand: source.brand, catalogNumber: source.catalogNumber, spec: source.spec, unit: source.unit, quantity: source.quantity },
    offer: { writtenSupplier: terms.writtenSupplier, unitPriceCents: terms.unitPriceCents, currency: terms.currency, taxBasis: terms.taxBasis,
      freightTerms: terms.freightTerms, leadTime: terms.leadTime, validUntil: terms.validUntil, supplierConditions: terms.supplierConditions } };
}

type Scope = ReturnType<typeof documentLine>;

function compareScope(known: Scope, intended: Scope) {
  if (known.kind !== intended.kind || (known.row === intended.row && pricingContentHash(known) !== pricingContentHash(intended))) {
    throw new PurchaseError('该供货书证行已对应其他商品、数量或条款，请核对涵盖本行的报价');
  }
}

export async function assertSupplierDocumentScopes(tx: Db, lines: SupplyLine[], attestation?: { orderId: string; actor: PurchaseActor }) {
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
    for (const known of [...previous, ...legacy.map(row => documentLine({ source: JSON.parse(row.source), terms: JSON.parse(row.terms) }))]) {
      compareScope(known, intended);
    }
    if (attestation && !previous.some(row => row.row === intended.row)) {
      await addPurchaseActivity(tx, { orderId: attestation.orderId, orderItemId: line.source.orderItemId,
        actor: attestation.actor, action: 'review_supplier_document_scope',
        referenceKey: pricingContentHash({ purpose: 'supplier_document_row', sha256: intended.sha256, row: intended.row }),
        detail: { document: intended, reference: line.terms.sourceReference } });
    }
  }
}
