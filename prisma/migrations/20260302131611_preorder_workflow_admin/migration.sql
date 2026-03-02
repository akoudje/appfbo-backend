-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PreorderStatus" ADD VALUE 'PAYMENT_PROOF_RECEIVED';
ALTER TYPE "PreorderStatus" ADD VALUE 'READY';
ALTER TYPE "PreorderStatus" ADD VALUE 'FULFILLED';

-- AlterTable
ALTER TABLE "Preorder" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "deliveryTracking" TEXT,
ADD COLUMN     "fulfilledAt" TIMESTAMP(3),
ADD COLUMN     "fulfilledBy" TEXT,
ADD COLUMN     "internalNote" TEXT,
ADD COLUMN     "invoicedAt" TIMESTAMP(3),
ADD COLUMN     "invoicedBy" TEXT,
ADD COLUMN     "packingNote" TEXT,
ADD COLUMN     "paymentLink" TEXT,
ADD COLUMN     "paymentProofNote" TEXT,
ADD COLUMN     "paymentProofUrl" TEXT,
ADD COLUMN     "paymentRef" TEXT,
ADD COLUMN     "paymentVerifiedBy" TEXT,
ADD COLUMN     "preparedAt" TIMESTAMP(3),
ADD COLUMN     "preparedBy" TEXT,
ADD COLUMN     "proofReceivedAt" TIMESTAMP(3),
ADD COLUMN     "proofReceivedBy" TEXT;

-- CreateTable
CREATE TABLE "PreorderLog" (
    "id" TEXT NOT NULL,
    "preorderId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreorderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PreorderLog_preorderId_createdAt_idx" ON "PreorderLog"("preorderId", "createdAt");

-- AddForeignKey
ALTER TABLE "PreorderLog" ADD CONSTRAINT "PreorderLog_preorderId_fkey" FOREIGN KEY ("preorderId") REFERENCES "Preorder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
