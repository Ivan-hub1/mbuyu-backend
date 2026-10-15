-- AlterTable
ALTER TABLE "Journey" ADD COLUMN     "isPaused" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MaintenanceTicket" ADD COLUMN     "photoAfter" TEXT,
ADD COLUMN     "photoAfterTakenAt" TIMESTAMP(3),
ADD COLUMN     "photoBefore" TEXT,
ADD COLUMN     "photoBeforeTakenAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "startedById" TEXT;

-- CreateIndex
CREATE INDEX "Journey_isPaused_idx" ON "Journey"("isPaused");

-- AddForeignKey
ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
