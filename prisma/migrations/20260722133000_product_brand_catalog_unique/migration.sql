DROP INDEX "Product_catalogNumber_key";

CREATE UNIQUE INDEX "Product_brand_catalogNumber_key"
ON "Product"("brand", "catalogNumber");
