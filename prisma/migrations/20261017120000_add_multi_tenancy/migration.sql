-- Multi-tenancy: introduce Tenant and scope every business table by tenantId.

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "trackingPrefix" TEXT NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_trackingPrefix_key" ON "Tenant"("trackingPrefix");

-- Default tenant for all pre-existing data
INSERT INTO "Tenant" ("id", "slug", "name", "isActive", "trackingPrefix", "createdAt", "updatedAt")
VALUES ('tenant_mbuyu', 'mbuyu', 'Mbuyu CFL', true, 'MBCFL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN';

-- DropIndex
DROP INDEX "User_email_key";

-- DropIndex
DROP INDEX "Vehicle_plate_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "ShipmentEvent" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "ShipmentDocument" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Checklist" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "MaintenanceTicket" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Journey" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "JourneyEvent" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "ShipmentTransfer" ADD COLUMN     "tenantId" TEXT;

-- Backfill: every existing row belongs to the original Mbuyu company
UPDATE "User" SET "tenantId" = 'tenant_mbuyu';
UPDATE "Quote" SET "tenantId" = 'tenant_mbuyu';
UPDATE "Shipment" SET "tenantId" = 'tenant_mbuyu';
UPDATE "ShipmentEvent" SET "tenantId" = 'tenant_mbuyu';
UPDATE "ShipmentDocument" SET "tenantId" = 'tenant_mbuyu';
UPDATE "Vehicle" SET "tenantId" = 'tenant_mbuyu';
UPDATE "Checklist" SET "tenantId" = 'tenant_mbuyu';
UPDATE "MaintenanceTicket" SET "tenantId" = 'tenant_mbuyu';
UPDATE "Journey" SET "tenantId" = 'tenant_mbuyu';
UPDATE "JourneyEvent" SET "tenantId" = 'tenant_mbuyu';
UPDATE "ShipmentTransfer" SET "tenantId" = 'tenant_mbuyu';

ALTER TABLE "User" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);
ALTER TABLE "Quote" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);
ALTER TABLE "Shipment" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);
ALTER TABLE "ShipmentEvent" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);
ALTER TABLE "ShipmentDocument" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);
ALTER TABLE "Vehicle" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);
ALTER TABLE "Checklist" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);
ALTER TABLE "MaintenanceTicket" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);
ALTER TABLE "Journey" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);
ALTER TABLE "JourneyEvent" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);
ALTER TABLE "ShipmentTransfer" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT current_setting('app.tenant_id'::text, true);

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Quote_tenantId_idx" ON "Quote"("tenantId");

-- CreateIndex
CREATE INDEX "Shipment_tenantId_idx" ON "Shipment"("tenantId");

-- CreateIndex
CREATE INDEX "ShipmentEvent_tenantId_idx" ON "ShipmentEvent"("tenantId");

-- CreateIndex
CREATE INDEX "ShipmentDocument_tenantId_idx" ON "ShipmentDocument"("tenantId");

-- CreateIndex
CREATE INDEX "Vehicle_tenantId_idx" ON "Vehicle"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_tenantId_plate_key" ON "Vehicle"("tenantId", "plate");

-- CreateIndex
CREATE INDEX "Checklist_tenantId_idx" ON "Checklist"("tenantId");

-- CreateIndex
CREATE INDEX "MaintenanceTicket_tenantId_idx" ON "MaintenanceTicket"("tenantId");

-- CreateIndex
CREATE INDEX "Journey_tenantId_idx" ON "Journey"("tenantId");

-- CreateIndex
CREATE INDEX "JourneyEvent_tenantId_idx" ON "JourneyEvent"("tenantId");

-- CreateIndex
CREATE INDEX "ShipmentTransfer_tenantId_idx" ON "ShipmentTransfer"("tenantId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentDocument" ADD CONSTRAINT "ShipmentDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyEvent" ADD CONSTRAINT "JourneyEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentTransfer" ADD CONSTRAINT "ShipmentTransfer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

