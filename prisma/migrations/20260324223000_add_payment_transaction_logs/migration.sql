-- CreateEnum
CREATE TYPE "PaymentTransactionEventType" AS ENUM (
  'PAYMENT_INITIATED',
  'PROVIDER_SESSION_CREATED',
  'CHECKOUT_LINK_READY',
  'STATUS_SYNCED',
  'WEBHOOK_RECEIVED',
  'WEBHOOK_INVALID_SIGNATURE',
  'WEBHOOK_PROCESSED',
  'WEBHOOK_PREORDER_UNRESOLVED',
  'TRANSACTION_CAPTURED',
  'PAYER_PHONE_CAPTURED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_EXPIRED',
  'PAYMENT_CANCELLED',
  'PAYMENT_FAILED',
  'DETAILS_ENRICHED',
  'SIMULATION_TRIGGERED',
  'SIMULATION_RESULT_APPLIED'
);

-- CreateEnum
CREATE TYPE "PaymentTransactionSource" AS ENUM (
  'INITIATE',
  'SYNC',
  'WEBHOOK',
  'SIMULATION',
  'ENRICHMENT',
  'SYSTEM'
);

-- CreateTable
CREATE TABLE "PaymentTransactionLog" (
  "id" TEXT NOT NULL,
  "preorderId" TEXT,
  "paymentId" TEXT,
  "paymentAttemptId" TEXT,
  "provider" "PaymentProvider",
  "eventType" "PaymentTransactionEventType" NOT NULL,
  "source" "PaymentTransactionSource" NOT NULL,
  "status" "PaymentStatus",
  "attemptStatus" "PaymentAttemptStatus",
  "providerStatus" TEXT,
  "providerSessionId" TEXT,
  "providerTransactionId" TEXT,
  "providerPayerPhone" TEXT,
  "amountFcfa" INTEGER,
  "currencyCode" VARCHAR(3),
  "note" TEXT,
  "payloadJson" JSONB,
  "actorAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentTransactionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentTransactionLog_preorderId_createdAt_idx" ON "PaymentTransactionLog"("preorderId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentTransactionLog_paymentId_createdAt_idx" ON "PaymentTransactionLog"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentTransactionLog_paymentAttemptId_createdAt_idx" ON "PaymentTransactionLog"("paymentAttemptId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentTransactionLog_provider_providerSessionId_idx" ON "PaymentTransactionLog"("provider", "providerSessionId");

-- CreateIndex
CREATE INDEX "PaymentTransactionLog_provider_providerTransactionId_idx" ON "PaymentTransactionLog"("provider", "providerTransactionId");

-- CreateIndex
CREATE INDEX "PaymentTransactionLog_eventType_source_createdAt_idx" ON "PaymentTransactionLog"("eventType", "source", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentTransactionLog_actorAdminId_idx" ON "PaymentTransactionLog"("actorAdminId");

-- AddForeignKey
ALTER TABLE "PaymentTransactionLog" ADD CONSTRAINT "PaymentTransactionLog_preorderId_fkey" FOREIGN KEY ("preorderId") REFERENCES "Preorder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransactionLog" ADD CONSTRAINT "PaymentTransactionLog_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransactionLog" ADD CONSTRAINT "PaymentTransactionLog_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransactionLog" ADD CONSTRAINT "PaymentTransactionLog_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
