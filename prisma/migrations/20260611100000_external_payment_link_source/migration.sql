ALTER TABLE "ExternalPaymentLink"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'ADMIN';

CREATE INDEX IF NOT EXISTS "ExternalPaymentLink_source_idx"
  ON "ExternalPaymentLink"("source");
