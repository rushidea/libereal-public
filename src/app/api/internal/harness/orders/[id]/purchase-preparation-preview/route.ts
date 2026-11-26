import { harnessBusinessPreview } from '@/lib/harness-tools/business-route';
import { previewPurchasePreparationForHarness } from '@/lib/harness-tools/business-purchase';

export const POST = harnessBusinessPreview({
  tool: 'preview_purchase_preparation',
  scope: 'purchase.prepare.preview',
  fields: [],
  run: previewPurchasePreparationForHarness,
});
