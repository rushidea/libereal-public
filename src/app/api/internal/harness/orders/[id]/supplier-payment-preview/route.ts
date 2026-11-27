import { harnessBusinessPreview } from '@/lib/harness-tools/business-route';
import { previewSupplierPaymentForHarness } from '@/lib/harness-tools/business-purchase';

export const POST = harnessBusinessPreview({
  tool: 'preview_supplier_payment',
  scope: 'purchase.payment.preview',
  fields: ['purchaseOrderId', 'amountCents'],
  run: previewSupplierPaymentForHarness,
});
