# Checkout persistence and payment invariants

This slice adds optional checkout attempt keys to orders and inquiries, quote-line metadata, and a migration-managed active payment index. It does not run a database migration or deploy the application.

## Database preparation

A normal Prisma migration installs the schema-only partial index. Index creation fails if an order already has more than one active Alipay attempt; it does not update any financial row. Existing duplicates require a separate, explicit reconciliation decision before retrying the migration. Preserve all gateway and callback facts.

Prisma `db push` does not install partial SQL indexes. The synthetic CI database is prepared with `npx prisma db push` followed by `npx tsx scripts/prepare-ci-db-invariants.ts`. That helper only accepts the explicit `prisma/ci.db` path and the CI dummy authentication secret. Do not use it against a real database. The test database installs the same active statuses: `created`, `redirected`, and `WAIT_BUYER_PAY`.

Before applying migrations outside CI, review outstanding active attempts and retain a private audit trail. Production migration and deployment remain separate operations requiring explicit authorization.
