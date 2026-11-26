import { previewFinanceActionForHarness } from '@/lib/harness-tools/business-finance';
import { harnessBusinessPreview } from '@/lib/harness-tools/business-route';

export const POST = harnessBusinessPreview({
  tool: 'preview_finance_action',
  scope: 'finance.action.preview',
  fields: ['intent'],
  run: previewFinanceActionForHarness,
});
