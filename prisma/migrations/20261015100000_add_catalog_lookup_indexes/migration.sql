-- 货号匹配按小写比较。表达式索引让 LOWER(catalogNumber) 能走索引，避免大表预览时全表扫描。
CREATE INDEX IF NOT EXISTS "Product_catalog_lower_idx" ON "Product"(LOWER("catalogNumber")) WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Product_brand_catalog_lower_idx" ON "Product"("brand", LOWER("catalogNumber")) WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "ProductVariant_catalog_lower_idx" ON "ProductVariant"(LOWER("catalogNumber"));
