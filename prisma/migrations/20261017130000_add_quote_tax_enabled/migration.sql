-- Remember whether the admin turned tax on or off for a quote
ALTER TABLE "Quote" ADD COLUMN "taxEnabled" BOOLEAN;

-- Quotes that already carry a tax rate had tax switched on
UPDATE "Quote" SET "taxEnabled" = true WHERE "taxRate" IS NOT NULL AND "taxRate" <> '';
