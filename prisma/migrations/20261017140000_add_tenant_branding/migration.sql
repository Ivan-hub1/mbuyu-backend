-- Per-company branding for emails and quote PDFs
ALTER TABLE "Tenant" ADD COLUMN "tagline" TEXT,
ADD COLUMN "contactEmail" TEXT,
ADD COLUMN "contactPhone" TEXT,
ADD COLUMN "website" TEXT,
ADD COLUMN "address" TEXT;

-- The original company keeps the details that were hardcoded before
UPDATE "Tenant"
SET "tagline" = 'Freight & Logistics',
    "contactEmail" = 'info@mbuyucfl.com',
    "contactPhone" = '+256 755 028392',
    "website" = 'www.mbuyucfl.com',
    "address" = 'Kampala, Uganda'
WHERE "id" = 'tenant_mbuyu';
