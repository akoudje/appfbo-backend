-- CreateEnum
CREATE TYPE "PreorderPaymentMode" AS ENUM ('ESPECES', 'WAVE', 'ORANGE_MONEY');

-- AlterTable
ALTER TABLE "Preorder" ADD COLUMN     "preorderPaymentMode" "PreorderPaymentMode";

-- CreateIndex
CREATE INDEX "Preorder_preorderPaymentMode_idx" ON "Preorder"("preorderPaymentMode");
