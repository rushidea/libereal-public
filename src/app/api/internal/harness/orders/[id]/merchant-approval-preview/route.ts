import { harnessBusinessPreview } from '@/lib/harness-tools/business-route';
import { previewMerchantApprovalForHarness } from '@/lib/harness-tools/business-order-pricing';

export const POST = harnessBusinessPreview({
  tool: 'preview_merchant_approval',
  scope: 'order.approval.preview',
  fields: [],
  run: previewMerchantApprovalForHarness,
});
