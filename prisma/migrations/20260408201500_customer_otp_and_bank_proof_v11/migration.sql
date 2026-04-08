DO $$
BEGIN
  CREATE TYPE "BankPaymentStatus" AS ENUM (
    'NOT_REQUIRED',
    'WAITING_PROOF',
    'PROOF_SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'EXPIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "BankPaymentProofStatus" AS ENUM (
    'SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'EXPIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Preorder"
ADD COLUMN IF NOT EXISTS "bankPaymentStatus" "BankPaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN IF NOT EXISTS "bankPaymentDueAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "bankPaymentValidatedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "bankPaymentValidatedById" TEXT;

CREATE TABLE IF NOT EXISTS "CustomerOtpChallenge" (
  "id" TEXT NOT NULL,
  "countryId" TEXT NOT NULL,
  "fboId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'CUSTOMER_PORTAL_LOGIN',
  "channel" TEXT NOT NULL,
  "destinationMasked" TEXT,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerOtpChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BankPaymentProof" (
  "id" TEXT NOT NULL,
  "preorderId" TEXT NOT NULL,
  "countryId" TEXT NOT NULL,
  "fboId" TEXT NOT NULL,
  "status" "BankPaymentProofStatus" NOT NULL DEFAULT 'SUBMITTED',
  "declaredAmountFcfa" INTEGER,
  "reference" TEXT,
  "note" TEXT,
  "fileUrl" TEXT NOT NULL,
  "fileMimeType" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "originalFileName" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedByAdminId" TEXT,
  "rejectionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BankPaymentProof_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Preorder_bankPaymentStatus_bankPaymentDueAt_idx"
  ON "Preorder"("bankPaymentStatus", "bankPaymentDueAt");
CREATE INDEX IF NOT EXISTS "Preorder_bankPaymentValidatedById_idx"
  ON "Preorder"("bankPaymentValidatedById");

CREATE INDEX IF NOT EXISTS "CustomerOtpChallenge_countryId_fboId_createdAt_idx"
  ON "CustomerOtpChallenge"("countryId", "fboId", "createdAt");
CREATE INDEX IF NOT EXISTS "CustomerOtpChallenge_fboId_consumedAt_expiresAt_idx"
  ON "CustomerOtpChallenge"("fboId", "consumedAt", "expiresAt");

CREATE INDEX IF NOT EXISTS "BankPaymentProof_preorderId_createdAt_idx"
  ON "BankPaymentProof"("preorderId", "createdAt");
CREATE INDEX IF NOT EXISTS "BankPaymentProof_countryId_status_submittedAt_idx"
  ON "BankPaymentProof"("countryId", "status", "submittedAt");
CREATE INDEX IF NOT EXISTS "BankPaymentProof_fboId_submittedAt_idx"
  ON "BankPaymentProof"("fboId", "submittedAt");
CREATE INDEX IF NOT EXISTS "BankPaymentProof_reviewedByAdminId_reviewedAt_idx"
  ON "BankPaymentProof"("reviewedByAdminId", "reviewedAt");

DO $$
BEGIN
  ALTER TABLE "Preorder"
    ADD CONSTRAINT "Preorder_bankPaymentValidatedById_fkey"
    FOREIGN KEY ("bankPaymentValidatedById")
    REFERENCES "AdminUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CustomerOtpChallenge"
    ADD CONSTRAINT "CustomerOtpChallenge_countryId_fkey"
    FOREIGN KEY ("countryId")
    REFERENCES "Country"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CustomerOtpChallenge"
    ADD CONSTRAINT "CustomerOtpChallenge_fboId_fkey"
    FOREIGN KEY ("fboId")
    REFERENCES "Fbo"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "BankPaymentProof"
    ADD CONSTRAINT "BankPaymentProof_preorderId_fkey"
    FOREIGN KEY ("preorderId")
    REFERENCES "Preorder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "BankPaymentProof"
    ADD CONSTRAINT "BankPaymentProof_countryId_fkey"
    FOREIGN KEY ("countryId")
    REFERENCES "Country"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "BankPaymentProof"
    ADD CONSTRAINT "BankPaymentProof_fboId_fkey"
    FOREIGN KEY ("fboId")
    REFERENCES "Fbo"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "BankPaymentProof"
    ADD CONSTRAINT "BankPaymentProof_reviewedByAdminId_fkey"
    FOREIGN KEY ("reviewedByAdminId")
    REFERENCES "AdminUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

