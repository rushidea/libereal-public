-- 人工限额、停单与系统审查分开。已有限制默认仍由审查管理，财务再次设置后才标记为人工。
ALTER TABLE "CreditAccount" ADD COLUMN "statusSource" TEXT NOT NULL DEFAULT 'system';

UPDATE "AdminRole"
SET "description" = '用户审核、积分和账户限制', "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'customer_admin';

UPDATE "AdminRole"
SET "description" = '成交价、付款、退款、授信和报表', "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'finance_staff';
