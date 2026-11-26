import { getFulfillmentState } from '@/lib/harness-tools/business-fulfillment';
import { harnessBusinessRead } from '@/lib/harness-tools/business-route';

export const GET = harnessBusinessRead({
  tool: 'get_fulfillment_state',
  scope: 'fulfillment.read',
  run: getFulfillmentState,
});
