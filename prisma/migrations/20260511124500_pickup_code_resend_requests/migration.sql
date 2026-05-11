CREATE TABLE IF NOT EXISTS "PickupCodeResendRequest" (
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

    CONSTRAINT "PickupCodeResendRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PickupCodeResendRequest_countryId_status_createdAt_idx"
ON "PickupCodeResendRequest"("countryId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "PickupCodeResendRequest_preorderId_createdAt_idx"
ON "PickupCodeResendRequest"("preorderId", "createdAt");

CREATE INDEX IF NOT EXISTS "PickupCodeResendRequest_fboNumero_createdAt_idx"
ON "PickupCodeResendRequest"("fboNumero", "createdAt");

ALTER TABLE "PickupCodeResendRequest"
ADD CONSTRAINT "PickupCodeResendRequest_countryId_fkey"
FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PickupCodeResendRequest"
ADD CONSTRAINT "PickupCodeResendRequest_preorderId_fkey"
FOREIGN KEY ("preorderId") REFERENCES "Preorder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
