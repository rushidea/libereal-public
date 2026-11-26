import { previewAfterSaleActionForHarness } from '@/lib/harness-tools/business-after-sale';
import { harnessBusinessPreview } from '@/lib/harness-tools/business-route';

export const POST = harnessBusinessPreview({
  tool: 'preview_after_sale_action',
  scope: 'after_sale.action.preview',
  fields: ['intent'],
  run: previewAfterSaleActionForHarness,
});
