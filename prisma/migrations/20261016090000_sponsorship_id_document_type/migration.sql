-- CreateEnum
CREATE TYPE "SponsorshipIdDocumentType" AS ENUM ('CNI', 'PASSPORT', 'DRIVING_LICENSE', 'CONSULAR_CARD', 'OTHER');

-- AlterTable
ALTER TABLE "Sponsorship" ADD COLUMN     "idDocumentType" "SponsorshipIdDocumentType" NOT NULL DEFAULT 'CNI';

