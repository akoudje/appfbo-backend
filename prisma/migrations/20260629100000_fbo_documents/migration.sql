-- CreateEnum
CREATE TYPE "FboDocumentType" AS ENUM ('ACTIVITY_CERTIFICATE');

-- CreateEnum
CREATE TYPE "FboDocumentStatus" AS ENUM ('ISSUED', 'CANCELLED');

-- CreateTable
CREATE TABLE "FboDocument" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "fboId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "verificationToken" TEXT NOT NULL,
    "type" "FboDocumentType" NOT NULL DEFAULT 'ACTIVITY_CERTIFICATE',
    "status" "FboDocumentStatus" NOT NULL DEFAULT 'ISSUED',
    "fboNumber" TEXT NOT NULL,
    "fboFullName" TEXT NOT NULL,
    "fboEmail" TEXT,
    "fboGrade" "Grade",
    "fboPointDeVente" TEXT,
    "city" TEXT NOT NULL,
    "purpose" TEXT,
    "signatoryName" TEXT NOT NULL,
    "signatoryTitle" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledById" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FboDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FboDocument_documentNumber_key" ON "FboDocument"("documentNumber");
CREATE UNIQUE INDEX "FboDocument_verificationToken_key" ON "FboDocument"("verificationToken");
CREATE INDEX "FboDocument_countryId_issuedAt_idx" ON "FboDocument"("countryId", "issuedAt");
CREATE INDEX "FboDocument_fboId_issuedAt_idx" ON "FboDocument"("fboId", "issuedAt");
CREATE INDEX "FboDocument_status_issuedAt_idx" ON "FboDocument"("status", "issuedAt");
CREATE INDEX "FboDocument_fboNumber_idx" ON "FboDocument"("fboNumber");

-- AddForeignKey
ALTER TABLE "FboDocument" ADD CONSTRAINT "FboDocument_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FboDocument" ADD CONSTRAINT "FboDocument_fboId_fkey" FOREIGN KEY ("fboId") REFERENCES "Fbo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FboDocument" ADD CONSTRAINT "FboDocument_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FboDocument" ADD CONSTRAINT "FboDocument_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
