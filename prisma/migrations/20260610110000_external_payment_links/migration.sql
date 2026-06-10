-- CreateEnum
CREATE TYPE "ExternalPaymentLinkStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAID', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ExternalPaymentLink" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "externalReference" TEXT,
    "invoiceReference" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "customerFboNumber" TEXT,
    "amountFcfa" INTEGER NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'XOF',
    "paymentMethod" "PreorderPaymentMode",
    "status" "ExternalPaymentLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT,
    "description" TEXT,
    "instructions" TEXT,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalPaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalPaymentLink_token_key" ON "ExternalPaymentLink"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalPaymentLink_countryId_reference_key" ON "ExternalPaymentLink"("countryId", "reference");

-- CreateIndex
CREATE INDEX "ExternalPaymentLink_countryId_status_createdAt_idx" ON "ExternalPaymentLink"("countryId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalPaymentLink_externalReference_idx" ON "ExternalPaymentLink"("externalReference");

-- CreateIndex
CREATE INDEX "ExternalPaymentLink_invoiceReference_idx" ON "ExternalPaymentLink"("invoiceReference");

-- CreateIndex
CREATE INDEX "ExternalPaymentLink_customerPhone_idx" ON "ExternalPaymentLink"("customerPhone");

-- CreateIndex
CREATE INDEX "ExternalPaymentLink_customerFboNumber_idx" ON "ExternalPaymentLink"("customerFboNumber");

-- AddForeignKey
ALTER TABLE "ExternalPaymentLink" ADD CONSTRAINT "ExternalPaymentLink_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalPaymentLink" ADD CONSTRAINT "ExternalPaymentLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalPaymentLink" ADD CONSTRAINT "ExternalPaymentLink_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
