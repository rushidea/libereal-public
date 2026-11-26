import { harnessBusinessRead } from '@/lib/harness-tools/business-route';
import { getPricingContextForHarness } from '@/lib/harness-tools/business-order-pricing';

export const GET = harnessBusinessRead({
  tool: 'get_pricing_context',
  scope: 'pricing.read',
  run: getPricingContextForHarness,
});
