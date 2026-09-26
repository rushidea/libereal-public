import Database from 'better-sqlite3';
import { getDatabasePath } from '../src/lib/databasePath';
import { PROMOTION_RULES } from '../src/lib/cart-promotions/rules';
import { auditLegacyPromotionBindings, type PromotionSkuRecord } from '../src/lib/promotion-migration-audit';

const db = new Database(getDatabasePath(), { readonly: true, fileMustExist: true });
try {
  const skus = db.prepare(`SELECT p.id AS productId, NULL AS variantId, p.brand, p.catalogNumber, p.name, p.spec
    FROM Product p WHERE p.hazardous=0
    UNION ALL
    SELECT p.id AS productId, v.id AS variantId, p.brand, v.catalogNumber, p.name, v.spec
    FROM ProductVariant v JOIN Product p ON p.id=v.productId WHERE p.hazardous=0`).all() as PromotionSkuRecord[];
  const report = auditLegacyPromotionBindings(PROMOTION_RULES, skus);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const active = report.rules.filter((rule) => rule.lifecycle === 'active');
    const blocked = active.filter((rule) => rule.blockers.length > 0);
    console.log(`规格总数: ${report.skuCount}`);
    console.log(`规则总数: ${report.rules.length}，当前生效: ${active.length}，需处理: ${blocked.length}`);
    for (const rule of report.rules) {
      const groups = rule.groups.map((entry) => `${entry.key}=${entry.skuCount}`).join(', ');
      const blockers = rule.blockers.length ? `；${rule.blockers.join('；')}` : '';
      console.log(`[${rule.lifecycle}] ${rule.id}: ${groups}${blockers}`);
    }
    console.log(`重叠规则对: ${report.overlaps.length}`);
    for (const overlap of report.overlaps) {
      console.log(`${overlap.firstRuleId} <> ${overlap.secondRuleId}: ${overlap.skuCount} 个规格；示例 ${overlap.examples.join('、')}`);
    }
  }
} finally {
  db.close();
}
