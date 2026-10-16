/*
  Warnings:

  - A unique constraint covering the columns `[inviteToken]` on the table `Quote` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "inviteToken" TEXT,
ADD COLUMN     "inviteTokenSentAt" TIMESTAMP(3),
ADD COLUMN     "inviteUsedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "address" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "documentUrl" TEXT,
ADD COLUMN     "ninNumber" TEXT,
ADD COLUMN     "passportNumber" TEXT,
ADD COLUMN     "registrationCompleted" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "tinNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Quote_inviteToken_key" ON "Quote"("inviteToken");

-- CreateIndex
CREATE INDEX "Quote_email_idx" ON "Quote"("email");

-- CreateIndex
CREATE INDEX "Quote_inviteToken_idx" ON "Quote"("inviteToken");

-- CreateIndex
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");

-- CreateIndex
CREATE INDEX "Shipment_customerEmail_idx" ON "Shipment"("customerEmail");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
