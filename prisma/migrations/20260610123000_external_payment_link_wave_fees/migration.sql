-- Migration complémentaire pour les environnements où la première migration
-- external_payment_links aurait déjà été appliquée avant l'ajout des frais Wave.
ALTER TABLE "ExternalPaymentLink"
  ADD COLUMN IF NOT EXISTS "baseAmountFcfa" INTEGER,
  ADD COLUMN IF NOT EXISTS "serviceFeeFcfa" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "provider" "PaymentProvider" NOT NULL DEFAULT 'WAVE',
  ADD COLUMN IF NOT EXISTS "providerStatus" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
  ADD COLUMN IF NOT EXISTS "providerSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "providerTransactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "providerCheckoutUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "providerLaunchUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "providerPayerPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "providerStatusLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "providerPayloadJson" JSONB;

UPDATE "ExternalPaymentLink"
SET "baseAmountFcfa" = COALESCE("baseAmountFcfa", "amountFcfa"),
    "serviceFeeFcfa" = COALESCE("serviceFeeFcfa", 0),
    "provider" = COALESCE("provider", 'WAVE'),
    "providerStatus" = COALESCE("providerStatus", 'INITIATED');

CREATE INDEX IF NOT EXISTS "ExternalPaymentLink_provider_providerSessionId_idx"
  ON "ExternalPaymentLink"("provider", "providerSessionId");

CREATE INDEX IF NOT EXISTS "ExternalPaymentLink_provider_providerTransactionId_idx"
  ON "ExternalPaymentLink"("provider", "providerTransactionId");
