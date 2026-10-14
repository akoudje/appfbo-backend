-- CreateEnum
CREATE TYPE "SponsorshipStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED_PENDING_PURCHASE', 'VALIDATED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SponsorshipDocumentType" AS ENUM ('ID_FRONT', 'ID_BACK', 'PASSPORT', 'OTHER');

-- AlterTable
ALTER TABLE "Fbo" ADD COLUMN     "sponsorFboId" TEXT,
ADD COLUMN     "sponsorLinkedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CountrySettings" ADD COLUMN     "fboNumberPrefix" TEXT,
ADD COLUMN     "sponsorshipEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sponsorshipMinPurchaseFcfa" INTEGER NOT NULL DEFAULT 53000,
ADD COLUMN     "sponsorshipPurchaseWindowHours" INTEGER NOT NULL DEFAULT 48;

-- CreateTable
CREATE TABLE "Sponsorship" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "status" "SponsorshipStatus" NOT NULL DEFAULT 'DRAFT',
    "sponsorFboId" TEXT NOT NULL,
    "sponsorNumero" TEXT NOT NULL,
    "sponsorNom" TEXT NOT NULL,
    "sponsorGrade" "Grade" NOT NULL,
    "sponsorCity" TEXT,
    "sponsorPhone" TEXT,
    "lastName" TEXT NOT NULL,
    "firstNames" TEXT NOT NULL,
    "birthDate" DATE NOT NULL,
    "birthPlace" TEXT NOT NULL,
    "idDocumentNumber" TEXT NOT NULL,
    "passportNumber" TEXT,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "addressArea" TEXT,
    "city" TEXT NOT NULL,
    "postalBox" TEXT,
    "zoneCode" TEXT,
    "homeCountry" TEXT NOT NULL DEFAULT 'CI',
    "maritalStatus" TEXT,
    "childrenCount" INTEGER,
    "bankRib" TEXT,
    "spouseLastName" TEXT,
    "spouseFirstNames" TEXT,
    "spouseBirthDate" DATE,
    "spouseBirthPlace" TEXT,
    "profession" TEXT,
    "businessSector" TEXT,
    "tradeRegisterNumber" TEXT,
    "tradeRegisterDate" DATE,
    "tradeRegisterPlace" TEXT,
    "vatSubject" BOOLEAN,
    "asdiSubject" BOOLEAN,
    "consentText" TEXT,
    "consentVersion" TEXT,
    "consentAcceptedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "rejectionReason" TEXT,
    "recruitFboNumero" TEXT,
    "recruitFboId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "minPurchaseFcfa" INTEGER,
    "purchaseDeadlineAt" TIMESTAMP(3),
    "qualifyingPreorderId" TEXT,
    "validatedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sponsorship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorshipDocument" (
    "id" TEXT NOT NULL,
    "sponsorshipId" TEXT NOT NULL,
    "type" "SponsorshipDocumentType" NOT NULL,
    "storagePublicId" TEXT NOT NULL,
    "storageResourceType" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "originalFileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SponsorshipDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorshipLog" (
    "id" TEXT NOT NULL,
    "sponsorshipId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "meta" JSONB,
    "actorAdminId" TEXT,
    "actorFboId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SponsorshipLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sponsorship_countryId_status_idx" ON "Sponsorship"("countryId", "status");

-- CreateIndex
CREATE INDEX "Sponsorship_sponsorFboId_createdAt_idx" ON "Sponsorship"("sponsorFboId", "createdAt");

-- CreateIndex
CREATE INDEX "Sponsorship_recruitFboId_idx" ON "Sponsorship"("recruitFboId");

-- CreateIndex
CREATE INDEX "Sponsorship_idDocumentNumber_idx" ON "Sponsorship"("idDocumentNumber");

-- CreateIndex
CREATE INDEX "SponsorshipDocument_sponsorshipId_idx" ON "SponsorshipDocument"("sponsorshipId");

-- CreateIndex
CREATE INDEX "SponsorshipLog_sponsorshipId_createdAt_idx" ON "SponsorshipLog"("sponsorshipId", "createdAt");

-- AddForeignKey
ALTER TABLE "Fbo" ADD CONSTRAINT "Fbo_sponsorFboId_fkey" FOREIGN KEY ("sponsorFboId") REFERENCES "Fbo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sponsorship" ADD CONSTRAINT "Sponsorship_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sponsorship" ADD CONSTRAINT "Sponsorship_sponsorFboId_fkey" FOREIGN KEY ("sponsorFboId") REFERENCES "Fbo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sponsorship" ADD CONSTRAINT "Sponsorship_recruitFboId_fkey" FOREIGN KEY ("recruitFboId") REFERENCES "Fbo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsorshipDocument" ADD CONSTRAINT "SponsorshipDocument_sponsorshipId_fkey" FOREIGN KEY ("sponsorshipId") REFERENCES "Sponsorship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsorshipLog" ADD CONSTRAINT "SponsorshipLog_sponsorshipId_fkey" FOREIGN KEY ("sponsorshipId") REFERENCES "Sponsorship"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Activation du parrainage pour la Côte d'Ivoire (préfixe 225, achat minimum 53 000 F, 48 h).
UPDATE "CountrySettings" s
SET "sponsorshipEnabled" = true,
    "sponsorshipMinPurchaseFcfa" = 53000,
    "sponsorshipPurchaseWindowHours" = 48,
    "fboNumberPrefix" = '225'
FROM "Country" c
WHERE c.id = s."countryId" AND c.code = 'CIV';
