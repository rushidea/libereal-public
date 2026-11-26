import { getAfterSaleCase } from '@/lib/harness-tools/business-after-sale';
import { harnessBusinessRead } from '@/lib/harness-tools/business-route';

export const GET = harnessBusinessRead({
  tool: 'get_after_sale_case',
  scope: 'after_sale.read',
  run: getAfterSaleCase,
});
