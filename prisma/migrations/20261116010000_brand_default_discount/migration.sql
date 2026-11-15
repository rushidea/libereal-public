-- No inferred rates: existing brands retain an unconfirmed NULL value.
ALTER TABLE "Brand" ADD COLUMN "defaultDiscountRate" REAL;
