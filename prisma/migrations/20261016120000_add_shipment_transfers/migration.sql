-- Shipment transfers (feature shipped in c3d2576 without a migration;
-- databases that already have the table should mark this as applied:
--   npx prisma migrate resolve --applied 20261016120000_add_shipment_transfers)

-- CreateEnum
CREATE TYPE "TransferReason" AS ENUM ('BREAKDOWN', 'ACCIDENT', 'SECURITY_INCIDENT', 'DRIVER_FATIGUE', 'DRIVER_UNAVAILABLE', 'ROUTE_BLOCKED', 'OTHER');

-- CreateEnum
CREATE TYPE "CargoCondition" AS ENUM ('INTACT', 'PARTIALLY_DAMAGED', 'MISSING_ITEMS', 'MAJOR_DAMAGE', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "JourneyStatus" ADD VALUE 'TRANSFERRED';

-- AlterTable
ALTER TABLE "Journey" ADD COLUMN     "transferredFromId" TEXT;

-- CreateTable
CREATE TABLE "ShipmentTransfer" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "oldJourneyId" TEXT NOT NULL,
    "newJourneyId" TEXT,
    "initiatedById" TEXT NOT NULL,
    "oldDriverId" TEXT NOT NULL,
    "newDriverId" TEXT NOT NULL,
    "newVehicleId" TEXT NOT NULL,
    "reason" "TransferReason" NOT NULL,
    "reasonNote" TEXT,
    "cargoCondition" "CargoCondition" NOT NULL DEFAULT 'UNKNOWN',
    "cargoNotes" TEXT,
    "missingItems" TEXT,
    "damageNotes" TEXT,
    "photoUrls" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "locationName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShipmentTransfer_shipmentId_idx" ON "ShipmentTransfer"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipmentTransfer_oldJourneyId_idx" ON "ShipmentTransfer"("oldJourneyId");

-- CreateIndex
CREATE INDEX "ShipmentTransfer_newJourneyId_idx" ON "ShipmentTransfer"("newJourneyId");

-- CreateIndex
CREATE INDEX "ShipmentTransfer_newDriverId_idx" ON "ShipmentTransfer"("newDriverId");

-- CreateIndex
CREATE INDEX "ShipmentTransfer_createdAt_idx" ON "ShipmentTransfer"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Journey_transferredFromId_key" ON "Journey"("transferredFromId");

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_transferredFromId_fkey" FOREIGN KEY ("transferredFromId") REFERENCES "Journey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentTransfer" ADD CONSTRAINT "ShipmentTransfer_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentTransfer" ADD CONSTRAINT "ShipmentTransfer_oldJourneyId_fkey" FOREIGN KEY ("oldJourneyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentTransfer" ADD CONSTRAINT "ShipmentTransfer_newJourneyId_fkey" FOREIGN KEY ("newJourneyId") REFERENCES "Journey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentTransfer" ADD CONSTRAINT "ShipmentTransfer_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentTransfer" ADD CONSTRAINT "ShipmentTransfer_oldDriverId_fkey" FOREIGN KEY ("oldDriverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentTransfer" ADD CONSTRAINT "ShipmentTransfer_newDriverId_fkey" FOREIGN KEY ("newDriverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

