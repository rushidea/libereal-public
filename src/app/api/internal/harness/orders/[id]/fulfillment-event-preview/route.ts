import { previewFulfillmentEvent } from '@/lib/harness-tools/business-fulfillment';
import { harnessBusinessPreview } from '@/lib/harness-tools/business-route';

export const POST = harnessBusinessPreview({
  tool: 'preview_fulfillment_event',
  scope: 'fulfillment.event.preview',
  fields: ['intent'],
  run: previewFulfillmentEvent,
});
