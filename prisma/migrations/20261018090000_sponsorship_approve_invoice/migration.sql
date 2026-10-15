-- AlterEnum
ALTER TYPE "SponsorshipStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "Sponsorship" ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "purchaseDeliveryMode" TEXT,
ADD COLUMN     "purchasePaymentMode" TEXT,
ADD COLUMN     "sponsorEmail" TEXT;

