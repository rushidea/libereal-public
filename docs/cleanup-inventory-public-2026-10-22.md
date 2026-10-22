# 公开仓库清理盘点（2026-10-22）

盘点对象：`rushidea/libereal-public`，分支 `staging-main` @ `c83fed7`（与 `origin/staging-main` 一致）。日期：2026-10-22。

本文件只记录证据和建议。它不删除、不移动、不修改任何既有文件。支付、积分、优惠券、询价、订单、MFA、权限、deploy 脚本、SEO 文章、sitemap 和结构化数据一律标为 **keep**，不进入删除候选。盘点没有读取 `.env` 或任何密钥。

建议取值：`remove`、`keep`、`investigate`。风险取值：低、中、高。

## 高置信度删除候选

这些项的证据是：静态导入图和全文检索都没有仓库内调用方，并且它们不是 Next.js 约定文件，也不属于上面的冻结范围。

| 位置 | 证据 | 建议 | 风险 | 预计改动 |
| --- | --- | --- | --- | --- |
| 下方 10 个未被引用的组件 | 符号名、文件名、`@/` 路径均无外部导入；仓库没有 `next/dynamic` | remove | 首页和促销套件为中，其余为低 | 10 个文件，1680 行 |
| `src/lib/types.ts` | 154 个 `src/lib/**/*.ts` 里唯一零导入模块；内容只有注释，无导出 | remove | 低 | 1 个文件，2 行 |
| `playwright-stealth`（devDependency `^0.0.1`） | 除 `package.json` 与 `package-lock.json` 外 0 次出现；`e2e/` 与 `playwright.config.ts` 未使用 | remove | 低 | 2 个文件：`package.json` 1 行，lockfile 约 6 行 |
| `e2e/_debug-featured.spec.ts` | 无 `expect`；文件头写明是首页调试；`playwright.config.ts` 的 `testDir: './e2e'` 没有 `testIgnore`，CI 会跑它 | remove | 低 | 1 个文件，61 行 |
| `next.config.ts` 里重复的 Abcepta `remotePatterns` | `https://www.abcepta.com.cn` 与 `https://abcepta.com.cn` 在约第 100–102 行和第 106–107 行各出现一次 | remove（只删重复项） | 低 | 1 个文件，约 4 行 |
| 15 个已合并远程分支（见第 4 节） | 分支 tip 已是 `main`、`staging-main` 或两者的祖先，且没有打开的 PR | remove（只删远程 ref） | 低 | 0 个文件 |

首页三个组件和促销目录组件虽然确认无人引用，但 `/promotions` 仍是一个空壳页面，首页也有 `src/app/dev/home-vision-playground/page.tsx`。删除前先确认没有即将接线的计划。

## 方法

- 组件、`src/lib`、`src/data`：解析 `from '...'`、`import()`、`require()`，允许跨行 import。再用符号名和路径做全文检索。
- Next.js 约定文件不算死代码：`page.tsx`、`layout.tsx`、`loading.tsx`、`error.tsx`、`not-found.tsx`、`template.tsx`、`default.tsx`、`route.ts`、`middleware.ts`、sitemap、robots、icon、manifest，以及路由组、平行路由、拦截路由。
- API `route.ts` 不因为「没有 TypeScript import」而判死。只在仓库内没有任何 URL 调用、并且能指出替代实现时标 `investigate`。
- 依赖：在 `src`、`scripts`、`e2e`、`miniprogram`、`public`、`prisma`、`docs` 和配置里检索包名，排除 `node_modules`、`.next`、`package-lock.json`。配置或脚本里的工具包算在用。
- 远程：`git ls-remote --heads origin`（20 个分支），`gh pr view` 20/21/22。祖先关系用 `git merge-base --is-ancestor` 核对。
- 仓库没有 knip / depcheck。未跑会改 lockfile 的安装。

`rg next/dynamic` 在 `*.ts` / `*.tsx` 中为 0。`src/` 里的 `import()` 是测试桩、`html2canvas` 和库模块，没有组件懒加载。

## 冻结为 keep

下列范围即使仓库内调用很少，也不列入删除候选。

| 范围 | 抽查到的位置 |
| --- | --- |
| 支付 | `src/lib/alipay.ts`、`src/app/api/payments/**`、订单支付宝路由、`alipay-sdk` |
| 积分 | `src/lib/points*.ts`、`src/app/api/points/**`、`src/app/api/admin/points/**` |
| 优惠券 / 折扣 | `src/lib/coupon-service.ts`、`src/app/api/coupons/route.ts`、`src/app/api/profile/discount/route.ts`、`src/app/api/admin/coupons/**`、`scripts/coupon-*.ts` |
| 询价 / 订单 | `src/app/api/inquiry/**`、`src/app/api/inquiries/**`、`src/app/api/orders/**`、`src/lib/order-*.ts`、`src/components/order/**`、`src/components/admin/ProductSearchOverlayForOrder.tsx` |
| MFA / 权限 | `src/lib/security/**`、`src/lib/auth*.ts`、`src/app/api/auth/**`、`src/app/login/**`、`scripts/backfill-mfa-authenticators.ts`、`scripts/verify-mfa-unified-migration.ts` |
| deploy | 仓库内没有文件名含 deploy 的脚本，`package.json` 也没有 deploy script。此项没有删除候选 |
| SEO 文章 / sitemap / 结构化数据 | `src/lib/seo/**`、`src/app/sitemap.xml/**`、`src/app/robots.txt/route.ts`、`src/components/JsonLd.tsx`、`src/data/discovery-seo-articles.ts`、`scripts/cron-indexnow.py`、微信文章与发布脚本 |

认证包 `@auth/prisma-adapter`、`@auth/core` 见第 2 节：仓库内几乎没有 import，仍因认证冻结标 keep。

## 1. 死代码

### 1.1 组件：remove

导入图从 App Router 的 `page.tsx` / `layout.tsx` 和测试入口做了可达性检查。`src/` 下没有组件 barrel（`index.ts` 再导出）。下面 10 个文件的导入方为空，或只被同组死文件导入。

| 路径 | 证据 | 建议 | 风险 | 预计改动 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| `src/components/home/HomeServiceCatalog.tsx` | `HomeServiceCatalog` 与 `@/components/home/HomeServiceCatalog` 只有定义 | remove | 中 | 1 文件，339 行 | 高 |
| `src/components/home/HomeResearchHero.tsx` | 只有定义。它 import 了仍在首页使用的 `ResearchLifeMosaic`，删 Hero 时不要删 Mosaic | remove | 中 | 1 文件，146 行 | 高 |
| `src/components/home/HomeResearchTrends.tsx` | 只有定义 | remove | 低 | 1 文件，64 行 | 高 |
| `src/components/promotions/PromotionCatalogClient.tsx` | `@/components/promotions/PromotionCatalogClient` 为 0。`/promotions` 页面没有引用它 | remove | 中 | 1 文件，265 行 | 高 |
| `src/components/promotions/PromotionActivityProgress.tsx` | 只有定义。购物车仍使用另一套 `CartPromotionPanel` | remove | 中 | 1 文件，238 行 | 高 |
| `src/components/promotions/PromotionHero.tsx` | 只有定义，并且是 `PromotionShareButton` 的唯一导入方 | remove | 中 | 1 文件，185 行 | 高 |
| `src/components/promotions/PromotionShareButton.tsx` | 唯一导入方是无人引用的 `PromotionHero.tsx` | remove | 低 | 1 文件，251 行 | 高 |
| `src/components/promotions/PromotionViewToggle.tsx` | 只有定义 | remove | 低 | 1 文件，53 行 | 高 |
| `src/components/admin/ProductSearchOverlay.tsx` | 只有定义。订单页用的是 `ProductSearchOverlayForOrder`（冻结，保留） | remove | 低 | 1 文件，108 行 | 高 |
| `src/components/CatalogNumberLink.tsx` | 只有定义 | remove | 低 | 1 文件，31 行 | 高 |

合计 10 个文件、1680 行。促销目录 UI 和首页三块是「确认未接线」，不是「确认产品已放弃」。

### 1.2 看起来像死代码、实际要 keep 或 investigate

| 路径 | 证据 | 建议 | 风险 | 预计改动 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| 全部 `src/app/**/page.tsx`（约 95 个）、各 `layout.tsx`、`not-found.tsx` | App Router 约定，不需要被 import | keep | 高（若误删） | 0 | 高 |
| `src/app/robots.txt/route.ts`、`src/app/sitemap.xml/route.ts`、`src/app/sitemaps/[shard]/route.ts`、`src/app/indexnow-key.txt/route.ts` | SEO 约定路由 | keep | 高 | 0 | 高 |
| 11 个 `*Client.tsx` | 由同目录 `page.tsx` 用相对路径导入，例如 `(home)/page.tsx` → `./HomeClient` | keep | 高 | 0 | 高 |
| `DesktopSiteNavigation.tsx`、`HeaderSearchField.tsx`、`CartPopover.tsx`、计算器、光谱图等 | 只用 `./` 相对导入，按路径字符串搜索会得到 0 | keep | 高 | 0 | 高 |
| `src/components/ViewportDebug.tsx` | 根 `src/app/layout.tsx` 挂载，组件内用 `?vt=1` 开关 | keep | 低 | 0 | 高 |
| `src/app/login-v2/page.tsx` | 再导出登录客户端；`src/proxy.ts` 识别 `/login-v2` | keep | 高 | 0 | 高 |
| `src/components/home/ResearchLifeCarousel.tsx` | 被仍在使用的 `ResearchLifeMosaic` 和 dev playground 引用 | keep | 高 | 0 | 高 |
| `src/app/promotions/page.tsx` | 页面本身是约定路由。促销组件未接线，页面不要当死代码删 | investigate | 中 | 0 到 6 个文件，取决于是否补接线 | 中 |
| `src/app/dev/home-vision-playground/page.tsx` | 可访问路由，没有生产环境保护（对比 `dev/mail-preview`） | investigate | 中 | 1 个页面，约 45 行，若决定下线 | 中 |
| `src/lib/articleImages.ts` | 生产代码 0 引用，只有 `src/test/articleImages.test.ts`。函数是文章配图提取 | keep | 中 | 若将来确认不用：2 个文件，约 358 行。本次不列入删除 | 高（仅测试引用） |
| `src/lib/wb-antibody-match.ts` | 只有 `src/test/wb-antibody-match.test.ts`。Western blot 场景页仍在 | investigate | 中 | 2 个文件，约 398 行 | 高（仅测试引用） |
| `src/lib/security/mfa-spike.ts` | 只有 `src/test/mfa-spike.test.ts` | keep | 中 | 0。MFA 冻结 | 高 |
| `src/lib/security/admin-mfa-adjustment-grant.ts` | 只有 `src/test/admin-mfa-adjustment-grant.test.ts` | keep | 中 | 0。MFA 冻结 | 高 |

`src/lib` 在修正多行 import 之后，零导入文件只有 `src/lib/types.ts`。早先按单行 import 扫描会把 `articleImages.ts`、`wechat-publish.ts`、`product-variant-lookup.ts` 等误判成孤儿；它们都有导入方。

### 1.3 API 路由

`src/app/api/**/route.ts` 共 167 个。默认 keep。

| 路径 | 证据 | 建议 | 风险 | 预计改动 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| `src/app/api/device/route.ts` | 仓库内没有 `/api/device` 调用。`src/proxy.ts` 已按 UA 写入同一个 `device-type` cookie | investigate | 中 | 1 个文件，13 行。外部客户端仍可能请求该 URL | 中 |
| `src/app/api/coupons/route.ts` | `GET /api/coupons` 只在本文件注释中出现。结算走订单定价预览，不走这个列表 | keep | 中 | 0。优惠券冻结 | 高 |
| `src/app/api/profile/discount/route.ts` | 仓库内没有 `/api/profile/discount` 调用。账户页请求的是 `/api/profile` | keep | 中 | 0。折扣冻结 | 高 |
| `src/app/api/debug-session/route.ts` | 无前端调用；`NODE_ENV === 'production'` 时返回 404 | keep | 低 | 0。有意保留的开发接口 | 高 |
| `src/app/api/inquiry/route.ts` 与 `src/app/api/inquiries/**` | e2e 把创建和后台列表分成两条路由 | keep | 高 | 0 | 高 |

### 1.4 脚本

`package.json` 或 CI 已引用、应保留的脚本：`prepare-ci-db-invariants.ts`、`seed-e2e-ci.ts`、`background-task-worker.ts`、`audit-promotion-rule-bindings.ts`、`reclassify-material-consumables.cjs`、`set-admin-password.js`、`sync-b02-public.mjs`、`sync-b03-public.mjs`、`sync-h022-public.mjs`、`sync-research-trends.mjs`。`cache-tool-favicons.mjs` 被 `src/lib/tool-favicon.ts` 提到。`wechat-delete-published.mjs` 有测试引用。

没有仓库内引用、但属于冻结范围，标 keep：

| 路径 | 证据 | 建议 | 风险 | 预计改动 |
| --- | --- | --- | --- | --- |
| `scripts/coupon-engine-test.ts`（约 113 行）、`scripts/coupon-service-test.ts`（约 166 行） | 不在 `package.json` / CI | keep | 中 | 0 |
| `scripts/backfill-mfa-authenticators.ts`（约 35 行）、`scripts/verify-mfa-unified-migration.ts`（约 142 行） | 不在 `package.json` / CI | keep | 中 | 0 |
| `scripts/cron-indexnow.py`（约 243 行） | 不在 CI；应用内另有 `src/app/api/cron/indexnow/route.ts` | keep | 中 | 0 |
| `scripts/sync-wechat-images.mjs`、`wechat-publish.mjs`、`wechat-draft-fetch.mjs`、`wechat-check-publish.mjs` | 不在 CI，但是文章发布操作脚本 | keep | 中 | 0 |
| `scripts/verify-platform-fee.ts`（29 行） | 不在 CI；直接调用 `calculateOrderAmounts`，属于订单金额核对 | keep | 中 | 0 |
| `scripts/engine-self-test.ts`、`promotions-semantics-test.ts`、`combo-gift-test.ts`、`landing3-test.ts` | 手工促销测试，不在目录校验 CI 里 | keep | 中 | 0。CI 已跑 `cart-promotions` 与 `automatic-promotions` 测试 |

没有引用、且不是冻结域的脚本。它们多半是一次性迁移或内容生成器，**不要**当成高置信度删除：

| 路径 | 证据 | 建议 | 风险 | 预计改动 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| `scripts/build-b07-h010-h012.mjs`（约 366）、`build-b08-h017-h018-h028-h029.mjs`（约 547）、`build-b09-h031-h032-h033-h041.mjs`（约 547）、`build-b10-h030-h038-h043-h044-h045.mjs`（约 624） | `package.json` 与 CI 均无引用。生成物在 `src/data/knowledge/` | investigate | 中 | 不要删；它们是内容源。四处合计约 2080 行 | 中 |
| `scripts/reclassify-elisa.mjs`（约 425）与 `scripts/reclassify-elisa-v2.mjs`（约 312） | 两者都无引用。行集合重叠很低 | investigate | 中 | 选错脚本会改分类。先确认哪一版已执行 | 中 |
| `scripts/reclassify-abcepta-antibodies.ts`（约 221）、`scripts/reclassify-abcepta-round2.ts`（约 266） | round2 import 了第一份的分类函数；包脚本未引用 | investigate | 中 | 2 个文件，约 487 行 | 中 |
| `scripts/reclassify-instrument-cryo-storage.ts`（约 110） | 脚本本身无外部引用；它 import 的 `src/lib/instrument-cryo-reclassify.ts` 有测试 | investigate | 低 | 1 个脚本加库与测试，若确认迁移已完成 | 中 |
| `scripts/sync-b04-public.mjs`（约 43） | `knowledge:sync-b02` / `b03` 有 npm script，b04 没有。生成 JSON 已在仓库 | investigate | 低 | 补 1 行 npm script，或维持手工运行。不要删 | 高 |
| `scripts/backfill-compound-type.ts`（约 84）、`backfill-small-pack-specs.ts`（约 56）、`backfill-thermo-sub-brands.ts`（约 49）、`align-discount-template-brands.ts`（约 70） | 无引用 | investigate | 中 | 一次性回填，折扣脚本靠近定价 | 中 |
| `scripts/classify-material-synth.ts`（约 1012）、`move-protein-marker.ts`（约 99）、`query-brand-stats.ts`（约 32）、`xlsx-to-csv.py`（约 27）、`cover-watermark.py`（约 137）、`gen_promo_og.py`（约 219）、`generate-promotion-share-images.ts`（约 114） | 无 `package.json` / CI 引用。`generate-promotion-share-images.ts` 是 `sharp` 的直接 import 之一 | investigate | 低到中 | 各自独立。分享图脚本先保留 | 中 |

文档漂移（文件已经不存在，要改的是引用而不是删代码）：

| 位置 | 证据 | 建议 | 风险 | 预计改动 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| `README.md` 约第 88 行 `npx tsx scripts/import-products.ts` | `scripts/import-products.ts` 不存在 | investigate | 低 | 1 个文档，约 1–4 行 | 高 |
| `src/app/api/admin/revalidate-filters/route.ts` 约第 10 行 | 注释提到 `scripts/update-cst-db.cjs`，文件不存在。路由本身仍有效 | investigate | 低 | 1 行注释 | 高 |

`miniprogram/`（10 个文件）是独立小程序，会调用 `/api/auth/wechat-mini/*`。它不被 Next 应用 import，这是正常的。建议 keep。

`hyperframes/home-vision-hero/`（15 个文件）有自己的 `package.json`，根 `package.json` 和 CI 都没有引用。建议 investigate，风险中。它可能是首页视觉稿，不要直接删。

## 2. 依赖

直接依赖和 devDependencies 都按包名检索过。`@types/*` 没有字面量引用是正常的，运行时包在用就保留。

### remove

| 包 | 证据 | 建议 | 风险 | 预计改动 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| `playwright-stealth` `^0.0.1` | 仅 `package.json` 与 lockfile。e2e 与 Playwright 配置都没有 import | remove | 低 | 2 个文件，`package.json` 1 行，lockfile 一小段 | 高 |

### 未使用但冻结为 keep

| 包 | 证据 | 建议 | 风险 | 预计改动 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| `@auth/prisma-adapter` `^2.11.1` | `src/`、`scripts/`、`e2e/`、`docs/` 中 `@auth/prisma-adapter` 与 `PrismaAdapter` 均为 0。`src/lib/auth.ts` 使用 `next-auth` 和 `better-sqlite3` | keep | 高（若未做认证复查就删） | 本次 0 | 高（无人 import） |
| `@auth/core` `0.41.3` | 没有 `from "@auth/core"`。`docs/security/passkey-dependencies.md` 提到它，且 `package.json` 的 `overrides` 把它钉死以配合 `next-auth` | keep | 高 | 0 | 高 |

### investigate（两个都在用，或只是放错依赖组）

| 包或位置 | 证据 | 建议 | 风险 | 预计改动 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| `d3` 与 `recharts` | `SpectrumChart.tsx` import `d3`；`ElisaCurveCalculator.tsx` import `recharts`。两个屏幕都活着 | investigate | 中 | 不是删一行。替换任何一边都要改对应页面和测试 | 高 |
| `@types/d3` 放在 `dependencies` | 无源码 import（类型包通常如此）。运行时用的是 `d3` | investigate | 低 | 移到 devDependencies 或在 `tsc` 通过后删除，1 行加 lockfile 分组变化 | 中 |
| `@types/bcryptjs` `^2.4.6` | 运行时是 `bcryptjs` 3.x，类型包主版本不同 | investigate | 中 | 删之前先跑 `tsc`。1 行 | 中 |
| `overrides.deepmerge-ts` `8.0.0` | 不是直接依赖。`@prisma/config@7.10.0` 要求 `deepmerge-ts@7.1.5`，override 解到 8.0.0 | investigate | 中 | 1 行 override，会改 lockfile | 中 |
| `overrides.mysql2` `3.23.1`、`overrides.uuid` `11.1.1` | `mysql2` 来自 Prisma（schema 仍是 sqlite）。`uuid` 来自 `exceljs` | keep | 低 | 0。这是安全钉版本 | 高 |

已核对且在用、保持不动的运行时包：`next`、`react`、`react-dom`、`lucide-react`、`@prisma/client`、`@prisma/adapter-better-sqlite3`、`next-auth`、`better-sqlite3`、`bcryptjs`、`@simplewebauthn/browser`、`@simplewebauthn/server`、`dotenv`、`exceljs`、`alipay-sdk`、`html2canvas`（动态 import）、`qrcode`、`markdown-it`、`undici`、`sharp`（分享图脚本，以及 Next 图片优化）。

工具包同样在用：`typescript`、`vitest`、`tsx`、`eslint`、`eslint-config-next`、`prisma`、`@playwright/test`、`tailwindcss`、`@tailwindcss/postcss`、`@tailwindcss/typography`、`@vitejs/plugin-react`、`jsdom`、`@testing-library/react`、`@testing-library/jest-dom`、`@vitest/ui`（对应 `test:ui`）。没有第二套日期库、HTTP 客户端或 UI kit 作为直接依赖。

## 3. 重复模块

有意拆开的不记为重复：`wechat-auth.ts` / `wechat-mini-auth.ts` / `wechat-sign-in.ts`，`pricing.ts` / `product-pricing.ts`，`coupon-service.ts` 与 `cart-promotions/strategies/coupon.ts`，以及 `reclassify-abcepta-round2.ts` 对第一份脚本的 import。

| 位置 | 证据 | 建议 | 风险 | 预计改动 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| `scripts/sync-b02-public.mjs`、`sync-b03-public.mjs`、`sync-b04-public.mjs` | 同一套快照校验，批次号和禁止键不同。b02 与 b03 行集合 Jaccard 约 0.67 | investigate | 低 | 抽参数约 160 行、3 个文件。不要删任一文件 | 高 |
| `scripts/sync-research-trends.mjs` 与 `scripts/sync-h022-public.mjs` | 各自有一份本地 `parseCsv`，开头约 45 行 | investigate | 低 | 抽一个约 40 行的 helper。两个入口都留 | 高 |
| `scripts/build-b07` 到 `build-b10` | 脚手架相似，主题数据不同。b08 与 b09 Jaccard 约 0.29 | investigate | 中 | 不要合并后删除内容 | 中 |
| `scripts/reclassify-elisa.mjs` 与 `reclassify-elisa-v2.mjs` | 同一件事的两代实现，Jaccard 约 0.05 | investigate | 中 | 先定当前版本。不是安全删除 | 中 |
| `ProductSearchOverlay.tsx` 与 `ProductSearchOverlayForOrder.tsx` | 行集合 Jaccard 约 0.35，都请求 `/api/products`。只有 ForOrder 被 `src/app/admin/orders/page.tsx` 导入 | investigate 后可删无导入的那份 | 低 | 删除候选就是第 1.1 节的 108 行。订单那份保留 | 高 |
| `scripts/wechat-*.mjs` 里的四份 `loadEnv` | 各 20–21 行，不是逐字节相同 | investigate | 低 | 抽 helper，不删 CLI。微信脚本冻结为保留 | 高 |
| `e2e/scenes-*.spec.ts` | 场景标题和锚点不同，IHC 与免疫荧光 Jaccard 约 0.53 | keep | 低 | 0 | 高 |

## 4. 远程分支与打开的 PR

默认分支是 `main`。当前集成基线是 `staging-main`。两者在 `53446ae`（PR #11，2026-10-04）之后分开。

| 分支 | tip 日期 | 相对关系 | 建议 |
| --- | --- | --- | --- |
| `main` `a52cb35` | 2026-10-06 | 比 `staging-main` 超前 19、落后 2 | keep |
| `staging-main` `c83fed7` | 2026-10-06 | 比 `main` 超前 2、落后 19。多出来的是 PR #19 | keep |

`main` 上多出的 19 个提交是 PR #12–#18（Bing robots/SEO、产品标题、目录服务端渲染、Next 16.3.8 钉版本、产品变体）。两边的 `package.json` 在 tip 上都是 `next` 16.3.8、`sharp` 0.35.4、`markdown-it` ^14.3.0。自 2026-10-06 起两条线都没有新提交。这是分叉，不是可删分支。建议 investigate，风险高：把 `main` 合进 `staging-main` 会带上约 38 个文件、+2013 / −1178，而且当前三个 PR 都基于 `staging-main`，并不包含这段目录和 SEO 工作。

打开的 PR 只有 #20、#21、#22，全部以 `staging-main` 为 base。历史上一共 22 个 PR，19 个已合并，没有「关闭但未合并」的 PR。分支保护 API 返回 HTTP 403，必选检查以仓库设置为准，下面只记录已经跑完的 GitHub Actions。

### PR #20

- 链接：https://github.com/rushidea/libereal-public/pull/20
- 标题：Repair product variant consistency on production line
- 作者：`rushidea`。状态：Open draft。base `staging-main`，head `codex/product-variant-production-only`（`ec9b0eb`）
- 创建 / 更新：2026-10-06 14:42 UTC / 2026-10-06 15:49 UTC
- 合并：`MERGEABLE`，`mergeStateStatus=CLEAN`，无冲突。仍是 draft
- 差异：6 个文件，+294 / −147。`ProductDetailClient.tsx`、产品页 1 行、两个测试，以及 `sharp` 0.35.4 → 0.35.5。`markdown-it` 仍是 `^14.3.0`
- CI：run [37488732308](https://github.com/rushidea/libereal-public/actions/runs/37488732308)，六项全为 SUCCESS（`security-audit`、`lint-and-type`、`unit-tests`、`catalog-search-promotion-validation`、`e2e-tests`、`build`）。结果已过 16 天
- 和 `main` 的关系：`ProductDetailClient.tsx` 相对 `main` 无差异。产品页相对 `main` 少了 `buildProductSeoTitle`，标题仍是模板字符串
- 和建议 #22 的关系：两边都改 lockfile。`sharp` 升级是 #22 的子集，#22 还升级了 `markdown-it`
- 建议：investigate。风险：中。预计改动：关闭 PR 本身不改树内文件。不要删 head 分支，`key` 那一行和 `sharp` 钉版本还不在 `staging-main` 上

### PR #21

- 链接：https://github.com/rushidea/libereal-public/pull/21
- 标题：feat(discoveries): 新增 SEO 文章页《一抗和二抗有什么区别？种属搭配、按实验选二抗一篇讲清》
- 作者：`rushidea`。状态：Open，不是 draft。base `staging-main`，head `seo/primary-vs-secondary-antibody`（`4914f2f`）
- 创建 / 更新：2026-10-19 14:19 UTC / 2026-10-20 15:24 UTC
- 合并：`MERGEABLE`，无冲突。`mergeStateStatus=BLOCKED`
- 差异：6 个文件，+871 / −2。新增 `/discoveries/primary-vs-secondary-antibody`、文章数据、列表入口和一条 sitemap 路径。没有 API、数据库或订单代码
- CI：run [39447944576](https://github.com/rushidea/libereal-public/actions/runs/39447944576)。`security-audit` FAILURE，其余五项 SUCCESS。head 仍是 `sharp` 0.35.4、`markdown-it` ^14.3.0，与当前 `staging-main` 相同
- 建议：keep。风险：中。这是冻结范围内的 SEO 文章，而且仍在活动。审计失败由 #22 的依赖升级覆盖。不要删 head 分支。关闭 PR 会丢掉尚未进 `staging-main` 的文章，树内已有文件不变

### PR #22

- 链接：https://github.com/rushidea/libereal-public/pull/22
- 标题：修复 security-audit：升级 sharp 与 markdown-it 传递依赖
- 作者：`rushidea`。状态：Open，不是 draft。base `staging-main`，head `cursor/security-deps-sharp-markdown-it-928d`（`8a10531`）
- 创建 / 更新：2026-10-20 14:48 UTC / 2026-10-20 19:12 UTC
- 合并：`MERGEABLE`，`mergeStateStatus=CLEAN`，无冲突
- 差异：2 个文件，+133 / −161。只有 `package.json` 和 `package-lock.json`。`sharp` 0.35.4 → 0.35.5，`markdown-it` ^14.3.0 → ^14.3.2
- CI：run [39481406158](https://github.com/rushidea/libereal-public/actions/runs/39481406158)，六项全为 SUCCESS，含 `security-audit`
- 建议：keep。风险：低。它是 #21 审计失败的对症修改。先合并它，#20 需要重新解 lockfile。不要删 head 分支

### 可删除的远程 ref

下面 15 个分支的 tip 已包含在 `main` 和/或 `staging-main` 中，没有打开的 PR。最后提交在 2026-09-27 至 2026-10-06。删除 ref 不改变任一 tip 的文件。每项建议 remove，风险低，预计改动 0 个文件，置信度高。

两边都包含：

- `codex/development-entry-migration`
- `codex/classification-promotion-migration`
- `codex/checkout-persistence-ui-migration`
- `codex/configured-credit-tier-lookup`
- `codex/fix-webauthn-attestation`
- `codex/repository-split-reference-fix`
- `fix/footer-operator-copy-20261004`

只在 `main`：

- `codex/bing-robots-directives`
- `codex/bing-seo-homepage`
- `codex/product-brand-seo`
- `codex/product-title-length`
- `codex/catalog-server-rendering`
- `codex/next-security-16-3-8`
- `codex/product-variant-route-price`

只在 `staging-main`（已由 PR #19 合并）：

- `codex/next-production-only`

保留：`main`、`staging-main`，以及三个打开 PR 的 head。删掉只在 `main` 上的 ref，不会把 PR #12–#18 带进 `staging-main`。

## 5. 配置、脚本与 workflow

`package.json` 里每个 script 指向的文件都存在。CI 点名的测试文件和 `scripts/prepare-ci-db-invariants.ts`、`scripts/seed-e2e-ci.ts` 都存在。`.github/workflows/` 只有 `ci.yml`。没有第二套 CI，也没有 knip/depcheck 配置。

| 位置 | 证据 | 建议 | 风险 | 预计改动 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| `.github/workflows/ci.yml` | 每个 job `node-version: '20'`。checkout 只有 `actions/checkout@v4` 本仓库。没有 `secrets.*`，没有私有仓库 checkout。数据库是 `file:./prisma/ci.db`。存在 `catalog-search-promotion-validation`，`e2e-tests` 和 `build` 依赖它 | keep | 低 | 0 | 高 |
| `ci.yml` 的 `build` job | `e2e-tests` 约第 136 行已经 `npm run build`。`build` job 约第 170 行在 e2e 之后又构建一次 | investigate | 低 | 可以去掉一个 job，不是无效 workflow | 高 |
| `package.json` 的 `test:coverage` 与 `vitest.config.ts` | 脚本是 `vitest run --coverage`，`coverage.provider` 为 `v8`。`@vitest/coverage-v8` 只是 `vitest@4.1.5` 的 optional peer，不是直接 devDependency，`npm ci` 不会安装它。`include: ['src/**/*/{ts,tsx}']` 的花括号匹配名为 `ts` 或 `tsx` 的文件，不是 `*.ts` / `*.tsx`。CI 不跑这个脚本 | investigate | 低 | 修正 glob 并补依赖，或删掉该 script。1–2 行加可能的 lockfile | 高 |
| `components.json` | shadcn schema。`src/app/globals.css` 存在。别名 `@/components/ui`、`@/lib/utils` 没有对应文件。`@/hooks` 有效（`useProductSearchSuggestions.ts` 被 `HeaderSearchField.tsx` 使用）。仓库没有 `class-variance-authority`、`clsx`、`tailwind-merge`。`shadcn` / `components.json` 没有其他引用 | investigate | 低 | 1 个文件，22 行，若确认不再用 shadcn CLI | 高 |
| `next.config.ts` `images.remotePatterns` | Abcepta 的两个 https hostname 重复，见摘要表。http 条目没有重复 | remove（重复项） | 低 | 约 4 行 | 高 |
| `eslint-config-next` `16.2.3` 与 `next` `16.3.8` | `eslint.config.mjs` 确实加载了 `eslint-config-next`。版本差一个 minor | investigate | 低 | 1 行版本号加 lockfile | 高 |
| `e2e/_debug-featured.spec.ts` | 见摘要。无断言，固定等待 5 秒，CI 会执行 | remove | 低 | 1 个文件，61 行。或在 `playwright.config.ts` 加 1 行忽略 `_debug*` | 高 |
| Prisma `engines.node` 与 Node 20 | schema 要求 `^20.19 \|\| ^22.12 \|\| >=24`。workflow 使用浮动 `node-version: '20'`，与 `AGENTS.md` 一致，当前 GitHub runner 满足 `^20.19` | keep | 低 | 0 | 高 |

## 未纳入本次删除候选的边界

- 动态 import 和路由约定已按上面的规则排除。没有发现用字符串拼出这 10 个组件路径的加载。
- 测试仍然引用的生产模块（`articleImages`、`wb-antibody-match`、MFA spike）没有标 remove。
- 一次性数据脚本、内容生成器和微信发布脚本没有标 remove。
- `main` 与 `staging-main` 的分叉需要人工决定集成方向，不属于清理删除。
