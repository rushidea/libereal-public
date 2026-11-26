import { harnessBusinessPreview } from '@/lib/harness-tools/business-route';
import { previewSupplyChangeForHarness } from '@/lib/harness-tools/business-purchase';

export const POST = harnessBusinessPreview({
  tool: 'preview_supply_change',
  scope: 'purchase.supply_change.preview',
  fields: ['purchaseOrderId', 'changeKind', 'affectedLines'],
  run: previewSupplyChangeForHarness,
});
