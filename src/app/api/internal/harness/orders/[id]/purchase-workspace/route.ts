import { harnessBusinessRead } from '@/lib/harness-tools/business-route';
import { getPurchaseWorkspaceForHarness } from '@/lib/harness-tools/business-purchase';

export const GET = harnessBusinessRead({
  tool: 'get_purchase_workspace',
  scope: 'purchase.read',
  run: getPurchaseWorkspaceForHarness,
});
