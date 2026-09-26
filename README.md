# LIBEREAL

生物医药试剂 B2B 电商平台 — 产品目录、询价报价、订单管理、积分与后台运营。

## 技术栈

- **前端**: Next.js 16 (App Router) + React 19 + Tailwind CSS 4
- **数据**: SQLite + Prisma 7 + better-sqlite3
- **认证**: NextAuth v5（邮箱密码 / Google / 微信）
- **测试**: Vitest + Playwright

## 快速开始

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，至少填写 AUTH_SECRET、Turnstile 密钥等

# 生成 Prisma Client 并同步数据库
npx prisma generate
npx prisma migrate deploy

# 开发
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

数据库文件位于 `prisma/dev.db`（开发环境默认路径，勿使用项目根目录下的 `dev.db`）。

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发服务器 |
| `npm run build` | 生产构建 |
| `npm run start` | 启动生产服务（需设置 `DATABASE_PATH`） |
| `npm run typecheck` | TypeScript 检查 |
| `npm run lint` | ESLint |
| `npm run test:run` | 单元测试 |
| `npm run test:e2e` | E2E 测试 |
| `npm run update-news` | 更新首页新闻缓存 |

## 环境变量

生产 SSH 部署（仅密钥，不含密码）：[`docs/DEPLOY-SSH.md`](docs/DEPLOY-SSH.md)。

详见 [`.env.example`](.env.example)。生产环境必须设置：

- `DATABASE_PATH` — SQLite 绝对路径，如 `/data/production.db`
- `AUTH_SECRET` — `openssl rand -hex 32`
- `AUTH_URL` / `NEXT_PUBLIC_SITE_URL` — 站点公网 URL
- `EMAIL_PROVIDER` / `EMAIL_FROM` / `EMAIL_REPLY_TO` — 系统邮件发送；生产建议使用 `resend` 或 `http`
- `ALIYUN_SMS_ACCESS_KEY_ID` / `ALIYUN_SMS_ACCESS_KEY_SECRET` / `ALIYUN_SMS_SIGN_NAME` — 阿里云短信服务端认证与签名
- `ALIYUN_SMS_TEMPLATE_CODE_REGISTER` / `ALIYUN_SMS_TEMPLATE_CODE_PHONE_CHANGE` / `ALIYUN_SMS_TEMPLATE_CODE_RESET_PASSWORD` — 注册、修改手机和重置密码验证码模板；`ALIYUN_SMS_TEMPLATE_CODE` 可作为通用兜底模板

完整部署清单见 [`docs/PRE-DEPLOY.md`](docs/PRE-DEPLOY.md)。
企业邮箱/Webmail 独立部署清单见 [`docs/mail-system.md`](docs/mail-system.md)。

## 项目结构

```
src/app/        页面与 API 路由
src/components/ 共享 UI 组件
src/lib/        服务端工具（auth、prisma、pricing）
prisma/         Schema、迁移、dev.db
scripts/        数据导入、爬虫、运维脚本
docs/           部署与审查文档
e2e/            Playwright 测试
```

AI 辅助开发指南见 [`AGENTS.md`](AGENTS.md)。UI 字号规范见 [`SPEC.md`](SPEC.md)。

## 核心业务流

1. 客户浏览产品 → 加入购物车
2. 提交询价单 → 管理员后台报价
3. 客户确认报价 → 生成订单 → 发货跟踪

## 数据导入

历史导入文件归档在 `backups/data-import/`。导入产品：

```bash
npx tsx scripts/import-products.ts
```
