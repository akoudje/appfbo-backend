-- AlterEnum
ALTER TYPE "PreorderLogAction" ADD VALUE IF NOT EXISTS 'BACKORDER_CREDIT_ISSUED';
ALTER TYPE "PreorderLogAction" ADD VALUE IF NOT EXISTS 'BACKORDER_CREDIT_CANCELLED';

-- CreateEnum
CREATE TYPE "BackorderCreditStatus" AS ENUM ('ISSUED', 'READY_FOR_PICKUP', 'FULFILLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PreorderBackorderCredit" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "preorderId" TEXT NOT NULL,
    "preorderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "priceFcfaSnapshot" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "reportedById" TEXT,
    "status" "BackorderCreditStatus" NOT NULL DEFAULT 'ISSUED',
    "parcelNumber" TEXT,
    "pickupSecretCode" TEXT,
    "preparedAt" TIMESTAMP(3),
    "preparedById" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "fulfilledById" TEXT,
    "pickupRecipientName" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreorderBackorderCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PreorderBackorderCredit_parcelNumber_key" ON "PreorderBackorderCredit"("parcelNumber");

-- CreateIndex
CREATE INDEX "PreorderBackorderCredit_countryId_status_idx" ON "PreorderBackorderCredit"("countryId", "status");

-- CreateIndex
CREATE INDEX "PreorderBackorderCredit_preorderId_idx" ON "PreorderBackorderCredit"("preorderId");

-- CreateIndex
CREATE INDEX "PreorderBackorderCredit_productId_status_idx" ON "PreorderBackorderCredit"("productId", "status");

-- AddForeignKey
ALTER TABLE "PreorderBackorderCredit" ADD CONSTRAINT "PreorderBackorderCredit_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderBackorderCredit" ADD CONSTRAINT "PreorderBackorderCredit_preorderId_fkey" FOREIGN KEY ("preorderId") REFERENCES "Preorder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderBackorderCredit" ADD CONSTRAINT "PreorderBackorderCredit_preorderItemId_fkey" FOREIGN KEY ("preorderItemId") REFERENCES "PreorderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderBackorderCredit" ADD CONSTRAINT "PreorderBackorderCredit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderBackorderCredit" ADD CONSTRAINT "PreorderBackorderCredit_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderBackorderCredit" ADD CONSTRAINT "PreorderBackorderCredit_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderBackorderCredit" ADD CONSTRAINT "PreorderBackorderCredit_fulfilledById_fkey" FOREIGN KEY ("fulfilledById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderBackorderCredit" ADD CONSTRAINT "PreorderBackorderCredit_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
