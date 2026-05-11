CREATE TABLE IF NOT EXISTS "PaymentLinkResendRequest" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "preorderId" TEXT NOT NULL,
    "preorderNumber" TEXT,
    "fboNumero" TEXT NOT NULL,
    "originalPhone" TEXT NOT NULL,
    "requestedWhatsappPhone" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedByAdminId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentLinkResendRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PaymentLinkResendRequest_countryId_status_createdAt_idx"
ON "PaymentLinkResendRequest"("countryId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "PaymentLinkResendRequest_preorderId_createdAt_idx"
ON "PaymentLinkResendRequest"("preorderId", "createdAt");

CREATE INDEX IF NOT EXISTS "PaymentLinkResendRequest_fboNumero_createdAt_idx"
ON "PaymentLinkResendRequest"("fboNumero", "createdAt");

ALTER TABLE "PaymentLinkResendRequest"
ADD CONSTRAINT "PaymentLinkResendRequest_countryId_fkey"
FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentLinkResendRequest"
ADD CONSTRAINT "PaymentLinkResendRequest_preorderId_fkey"
FOREIGN KEY ("preorderId") REFERENCES "Preorder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
