CREATE TABLE "Brand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "description" TEXT,
    "websiteUrl" TEXT,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "parentId" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProductCategory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ProductAttribute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT,
    "unit" TEXT,
    "source" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductAttribute_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ProductPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "kind" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductPrice_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ProductDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "version" TEXT,
    "language" TEXT DEFAULT 'zh-CN',
    "source" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductDocument_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "Product" ADD COLUMN "brandRecordId" TEXT REFERENCES "Brand"("id") ON DELETE SET NULL;
ALTER TABLE "Product" ADD COLUMN "categoryRecordId" TEXT REFERENCES "ProductCategory"("id") ON DELETE SET NULL;
ALTER TABLE "Product" ADD COLUMN "subcategoryRecordId" TEXT REFERENCES "ProductCategory"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");
CREATE INDEX "Brand_isActive_sortOrder_idx" ON "Brand"("isActive", "sortOrder");
CREATE UNIQUE INDEX "ProductCategory_parentId_name_key" ON "ProductCategory"("parentId", "name");
CREATE INDEX "ProductCategory_parentId_sortOrder_idx" ON "ProductCategory"("parentId", "sortOrder");
CREATE INDEX "ProductCategory_isActive_idx" ON "ProductCategory"("isActive");
CREATE UNIQUE INDEX "ProductAttribute_productId_key_value_key" ON "ProductAttribute"("productId", "key", "value");
CREATE INDEX "ProductAttribute_productId_sortOrder_idx" ON "ProductAttribute"("productId", "sortOrder");
CREATE INDEX "ProductAttribute_key_normalizedValue_idx" ON "ProductAttribute"("key", "normalizedValue");
CREATE INDEX "ProductPrice_productId_kind_createdAt_idx" ON "ProductPrice"("productId", "kind", "createdAt");
CREATE INDEX "ProductPrice_variantId_idx" ON "ProductPrice"("variantId");
CREATE INDEX "ProductPrice_isActive_startsAt_endsAt_idx" ON "ProductPrice"("isActive", "startsAt", "endsAt");
CREATE UNIQUE INDEX "ProductDocument_productId_type_url_key" ON "ProductDocument"("productId", "type", "url");
CREATE INDEX "ProductDocument_productId_sortOrder_idx" ON "ProductDocument"("productId", "sortOrder");
CREATE INDEX "ProductDocument_type_idx" ON "ProductDocument"("type");
CREATE INDEX "Product_brandRecordId_idx" ON "Product"("brandRecordId");
CREATE INDEX "Product_categoryRecordId_idx" ON "Product"("categoryRecordId");
CREATE INDEX "Product_subcategoryRecordId_idx" ON "Product"("subcategoryRecordId");

INSERT INTO "Brand" ("id", "name", "createdAt", "updatedAt")
SELECT 'brand:' || hex(trim("brand")), trim("brand"), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Product"
WHERE trim("brand") <> ''
GROUP BY trim("brand");

UPDATE "Product"
SET "brandRecordId" = 'brand:' || hex(trim("brand"))
WHERE trim("brand") <> '';

INSERT INTO "ProductCategory" ("id", "name", "createdAt", "updatedAt")
SELECT 'category:' || hex(trim("category")), trim("category"), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Product"
WHERE "category" IS NOT NULL AND trim("category") <> ''
GROUP BY trim("category");

UPDATE "Product"
SET "categoryRecordId" = 'category:' || hex(trim("category"))
WHERE "category" IS NOT NULL AND trim("category") <> '';

INSERT INTO "ProductCategory" ("id", "name", "parentId", "createdAt", "updatedAt")
SELECT
  'subcategory:' || hex(trim("category")) || ':' || hex(trim("subcategory")),
  trim("subcategory"),
  'category:' || hex(trim("category")),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Product"
WHERE "category" IS NOT NULL AND trim("category") <> ''
  AND "subcategory" IS NOT NULL AND trim("subcategory") <> ''
GROUP BY trim("category"), trim("subcategory");

UPDATE "Product"
SET "subcategoryRecordId" = 'subcategory:' || hex(trim("category")) || ':' || hex(trim("subcategory"))
WHERE "category" IS NOT NULL AND trim("category") <> ''
  AND "subcategory" IS NOT NULL AND trim("subcategory") <> '';
