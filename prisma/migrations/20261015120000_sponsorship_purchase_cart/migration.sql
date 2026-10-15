-- AlterTable
ALTER TABLE "Sponsorship" ADD COLUMN     "purchaseIndicativeTotalFcfa" INTEGER,
ADD COLUMN     "purchaseItems" JSONB,
ADD COLUMN     "purchasePreorderId" TEXT;

