ALTER TABLE "ExternalPaymentLink"
  ADD COLUMN IF NOT EXISTS "smsTo" TEXT,
  ADD COLUMN IF NOT EXISTS "smsStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "smsProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "smsProviderMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "smsLastError" TEXT,
  ADD COLUMN IF NOT EXISTS "smsLastSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "smsSendCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "ExternalPaymentLink_smsStatus_idx"
  ON "ExternalPaymentLink"("smsStatus");
