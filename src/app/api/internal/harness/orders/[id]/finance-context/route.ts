import { getFinanceWorkspace } from '@/lib/harness-tools/business-finance';
import { harnessBusinessRead } from '@/lib/harness-tools/business-route';

export const GET = harnessBusinessRead({
  tool: 'get_finance_workspace',
  scope: 'finance.read',
  run: getFinanceWorkspace,
});
