ALTER TABLE "TicketOrder"
ADD COLUMN IF NOT EXISTS "providerSessionId" TEXT,
ADD COLUMN IF NOT EXISTS "providerTransactionId" TEXT,
ADD COLUMN IF NOT EXISTS "providerCheckoutUrl" TEXT,
ADD COLUMN IF NOT EXISTS "providerLaunchUrl" TEXT,
ADD COLUMN IF NOT EXISTS "providerPayerPhone" TEXT,
ADD COLUMN IF NOT EXISTS "providerStatusLabel" TEXT,
ADD COLUMN IF NOT EXISTS "providerPayloadJson" JSONB;

CREATE INDEX IF NOT EXISTS "TicketOrder_paymentProvider_providerSessionId_idx"
ON "TicketOrder"("paymentProvider", "providerSessionId");
