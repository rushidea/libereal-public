import { harnessBusinessRead } from '@/lib/harness-tools/business-route';
import { getOrderContextForHarness } from '@/lib/harness-tools/business-order-pricing';

export const GET = harnessBusinessRead({
  tool: 'get_order_context',
  scope: 'order.read',
  run: getOrderContextForHarness,
});
