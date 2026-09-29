-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('NEW', 'REVIEWING', 'QUOTED', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'NEW',
    "fullName" TEXT NOT NULL,
    "companyName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "preferredContact" TEXT NOT NULL,
    "cargoType" TEXT NOT NULL,
    "transportMode" TEXT NOT NULL,
    "weightKg" TEXT NOT NULL,
    "volumeCbm" TEXT,
    "pieces" TEXT NOT NULL,
    "cargoDescription" TEXT NOT NULL,
    "cargoValue" TEXT,
    "cargoValueCurrency" TEXT,
    "originCountry" TEXT NOT NULL,
    "originCity" TEXT NOT NULL,
    "destinationCountry" TEXT NOT NULL,
    "destinationCity" TEXT NOT NULL,
    "shippingDate" TEXT NOT NULL,
    "incoterms" TEXT NOT NULL,
    "specialRequirements" TEXT,
    "hasDocuments" BOOLEAN NOT NULL DEFAULT false,
    "quotedAmount" TEXT,
    "quotedCurrency" TEXT,
    "adminResponse" TEXT,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_reference_key" ON "Quote"("reference");

-- CreateIndex
CREATE INDEX "Quote_status_idx" ON "Quote"("status");

-- CreateIndex
CREATE INDEX "Quote_createdAt_idx" ON "Quote"("createdAt");
