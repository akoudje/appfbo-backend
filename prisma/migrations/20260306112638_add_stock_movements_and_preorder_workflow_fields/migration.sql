/*
  Warnings:

  - Added the required column `prixCatalogueFcfa` to the `PreorderItem` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `action` on the `PreorderLog` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "PreorderLogAction" AS ENUM ('CREATE_DRAFT', 'SET_ITEMS', 'REPRICE', 'SUBMIT', 'INVOICE', 'RECEIVE_PAYMENT_PROOF', 'VERIFY_PAYMENT', 'MARK_PAID', 'PREPARE', 'FULFILL', 'CANCEL', 'STOCK_DEBIT', 'STOCK_CREDIT');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "StockMovementReason" AS ENUM ('PREPARE_ORDER', 'CANCEL_ORDER', 'MANUAL_ADJUSTMENT');

-- AlterTable
ALTER TABLE "Preorder" ADD COLUMN     "paymentVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "stockDeductedAt" TIMESTAMP(3),
ADD COLUMN     "stockRestoredAt" TIMESTAMP(3),
ALTER COLUMN "paymentMode" DROP NOT NULL,
ALTER COLUMN "deliveryMode" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PreorderItem" ADD COLUMN     "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "prixCatalogueFcfa" INTEGER NOT NULL,
ADD COLUMN     "productNameSnapshot" TEXT,
ADD COLUMN     "productSkuSnapshot" TEXT;

-- AlterTable
ALTER TABLE "PreorderLog" DROP COLUMN "action",
ADD COLUMN     "action" "PreorderLogAction" NOT NULL;

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "preorderId" TEXT,
    "type" "StockMovementType" NOT NULL,
    "reason" "StockMovementReason" NOT NULL,
    "qty" INTEGER NOT NULL,
    "note" TEXT,
    "meta" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_preorderId_idx" ON "StockMovement"("preorderId");

-- CreateIndex
CREATE INDEX "StockMovement_reason_createdAt_idx" ON "StockMovement"("reason", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_createdById_idx" ON "StockMovement"("createdById");

-- CreateIndex
CREATE INDEX "Preorder_factureReference_idx" ON "Preorder"("factureReference");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_preorderId_fkey" FOREIGN KEY ("preorderId") REFERENCES "Preorder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
