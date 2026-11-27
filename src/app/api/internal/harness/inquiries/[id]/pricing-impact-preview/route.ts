import { harnessBusinessPreview } from '@/lib/harness-tools/business-route';
import { previewPricingImpactForHarness } from '@/lib/harness-tools/business-order-pricing';

export const POST = harnessBusinessPreview({
  tool: 'preview_pricing_impact',
  scope: 'pricing.impact.preview',
  fields: ['quoteItemId', 'newPrice'],
  run: previewPricingImpactForHarness,
});
