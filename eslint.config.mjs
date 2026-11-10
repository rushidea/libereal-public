import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Existing files with newly surfaced React Hooks findings remain visible as
  // warnings during migration. New files and all other rules remain strict.
  {
    files: [
      "src/app/account/inquiries/page.tsx",
      "src/app/account/notifications/page.tsx",
      "src/app/login/wechat-mini/page.tsx",
    ],
    rules: { "react-hooks/immutability": "warn" },
  },
  {
    files: [
      "src/app/account/settings/page.tsx",
    ],
    rules: { "react-hooks/purity": "warn" },
  },
  {
    files: [
      "src/app/register/RegisterClient.tsx",
    ],
    rules: { "react-hooks/refs": "warn" },
  },
  {
    files: [
      "src/app/account/points/page.tsx",
      "src/app/account/security/page.tsx",
      "src/app/account/settings/page.tsx",
      "src/app/admin/access/page.tsx",
      "src/app/admin/community/page.tsx",
      "src/app/admin/coupons/page.tsx",
      "src/app/admin/inquiries/archived/page.tsx",
      "src/app/admin/inquiries/page.tsx",
      "src/app/admin/inventory/page.tsx",
      "src/app/admin/orders/archived/page.tsx",
      "src/app/admin/orders/page.tsx",
      "src/app/admin/organizations/page.tsx",
      "src/app/admin/pricing-adjustments/page.tsx",
      "src/app/admin/promotions/page.tsx",
      "src/app/admin/wechat-articles/page.tsx",
      "src/app/brands/\\[brand\\]/BrandProductsClient.tsx",
      "src/app/inquiry/page.tsx",
      "src/app/login/wechat-mini/page.tsx",
      "src/app/order/page.tsx",
      "src/app/payments/alipay/return/page.tsx",
      "src/app/products/catalog/page.tsx",
      "src/app/register/link/RegisterLinkClient.tsx",
      "src/components/ForcedAckOverlay.tsx",
      "src/components/account/InquiriesPanel.tsx",
      "src/components/account/OrderPrepaySettlement.tsx",
      "src/components/account/OrganizationsPanel.tsx",
      "src/components/admin/AdminNotificationsManager.tsx",
      "src/components/admin/DiscountTemplateManager.tsx",
      "src/components/admin/LegalDocumentsManager.tsx",
      "src/components/admin/PointsManager.tsx",
      "src/components/admin/ResearchGroupsManager.tsx",
      "src/components/community/Panels.tsx",
      "src/components/promotions/PromotionShareButton.tsx",
      "src/components/security/SecurityStepUpDialog.tsx",
      "src/context/CustomerNotificationsContext.tsx",
      "src/context/WishlistContext.tsx",
    ],
    rules: { "react-hooks/set-state-in-effect": "warn" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    // scripts/ is dev tooling (data import, scraping) - not in production bundle.
    // Has CommonJS require() calls and `any` types that don't fit src/ strict rules.
    // CI/quality gates should validate src/ only.
    "scripts/**",
  ]),
]);

export default eslintConfig;
