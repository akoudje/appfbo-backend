/*
  Warnings:

  - The values [RECEIVE_PAYMENT_PROOF,VERIFY_PAYMENT,MARK_PAID] on the enum `PreorderLogAction` will be removed. If these variants are still used in the database, this will fail.
  - The values [PAYMENT_PROOF_RECEIVED] on the enum `PreorderStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `cancelledBy` on the `Preorder` table. All the data in the column will be lost.
  - You are about to drop the column `fulfilledBy` on the `Preorder` table. All the data in the column will be lost.
  - You are about to drop the column `invoicedBy` on the `Preorder` table. All the data in the column will be lost.
  - You are about to drop the column `paymentLink` on the `Preorder` table. All the data in the column will be lost.
  - You are about to drop the column `paymentMode` on the `Preorder` table. All the data in the column will be lost.
  - You are about to drop the column `paymentProofNote` on the `Preorder` table. All the data in the column will be lost.
  - You are about to drop the column `paymentProofUrl` on the `Preorder` table. All the data in the column will be lost.
  - You are about to drop the column `paymentRef` on the `Preorder` table. All the data in the column will be lost.
  - You are about to drop the column `paymentVerifiedAt` on the `Preorder` table. All the data in the column will be lost.
  - You are about to drop the column `paymentVerifiedBy` on the `Preorder` table. All the data in the column will be lost.
  - You are about to drop the column `paymentVerifiedById` on the `Preorder` table. All the data in the column will be lost.
  - You are about to drop the column `preparedBy` on the `Preorder` table. All the data in the column will be lost.
  - You are about to drop the column `proofReceivedAt` on the `Preorder` table. All the data in the column will be lost.
  - You are about to drop the column `proofReceivedBy` on the `Preorder` table. All the data in the column will be lost.
  - You are about to drop the column `proofReceivedById` on the `Preorder` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "OrderMessageChannel" AS ENUM ('WHATSAPP');

-- CreateEnum
CREATE TYPE "OrderMessagePurpose" AS ENUM ('INVOICE', 'PAYMENT_LINK', 'REMINDER', 'PAYMENT_CONFIRMED', 'ORDER_READY');

-- CreateEnum
CREATE TYPE "OrderMessageStatus" AS ENUM ('DRAFT', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('WAVE', 'ORANGE_MONEY', 'MTN_MOMO', 'MOOV_MONEY', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('MOBILE_MONEY', 'CASH', 'BANK_TRANSFER', 'CARD', 'MANUAL_PROOF');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'PENDING_CUSTOMER_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATED', 'PROVIDER_SESSION_CREATED', 'REDIRECT_READY', 'PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('UNPAID', 'PAYMENT_PENDING', 'PAID', 'PARTIALLY_PAID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ProviderAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "BillingWorkStatus" AS ENUM ('NONE', 'QUEUED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER_DATA', 'WAITING_PAYMENT', 'COMPLETED', 'RELEASED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "BillingPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- AlterEnum
BEGIN;
CREATE TYPE "PreorderLogAction_new" AS ENUM ('CREATE_DRAFT', 'SET_ITEMS', 'REPRICE', 'SUBMIT', 'ENQUEUE_BILLING', 'ASSIGN_INVOICER', 'RELEASE_INVOICER', 'START_BILLING', 'ESCALATE_BILLING', 'WAIT_CUSTOMER_DATA', 'INVOICE', 'GENERATE_PAYMENT', 'PAYMENT_PENDING', 'RECEIVE_MANUAL_PAYMENT_PROOF', 'VALIDATE_MANUAL_PAYMENT', 'PAYMENT_CONFIRMED', 'PREPARE', 'FULFILL', 'CANCEL', 'STOCK_DEBIT', 'STOCK_CREDIT');
ALTER TABLE "PreorderLog" ALTER COLUMN "action" TYPE "PreorderLogAction_new" USING ("action"::text::"PreorderLogAction_new");
ALTER TYPE "PreorderLogAction" RENAME TO "PreorderLogAction_old";
ALTER TYPE "PreorderLogAction_new" RENAME TO "PreorderLogAction";
DROP TYPE "PreorderLogAction_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PreorderStatus_new" AS ENUM ('DRAFT', 'SUBMITTED', 'INVOICED', 'PAYMENT_PENDING', 'PAID', 'READY', 'FULFILLED', 'CANCELLED');
ALTER TABLE "Preorder" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Preorder" ALTER COLUMN "status" TYPE "PreorderStatus_new" USING ("status"::text::"PreorderStatus_new");
ALTER TYPE "PreorderStatus" RENAME TO "PreorderStatus_old";
ALTER TYPE "PreorderStatus_new" RENAME TO "PreorderStatus";
DROP TYPE "PreorderStatus_old";
ALTER TABLE "Preorder" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- DropForeignKey
ALTER TABLE "Preorder" DROP CONSTRAINT "Preorder_paymentVerifiedById_fkey";

-- DropForeignKey
ALTER TABLE "Preorder" DROP CONSTRAINT "Preorder_proofReceivedById_fkey";

-- DropIndex
DROP INDEX "Preorder_paymentVerifiedById_idx";

-- DropIndex
DROP INDEX "Preorder_proofReceivedById_idx";

-- AlterTable
ALTER TABLE "CountrySettings" ADD COLUMN     "billingClaimTimeoutMin" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "maxActiveBillingPerInvoicer" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "Preorder" DROP COLUMN "cancelledBy",
DROP COLUMN "fulfilledBy",
DROP COLUMN "invoicedBy",
DROP COLUMN "paymentLink",
DROP COLUMN "paymentMode",
DROP COLUMN "paymentProofNote",
DROP COLUMN "paymentProofUrl",
DROP COLUMN "paymentRef",
DROP COLUMN "paymentVerifiedAt",
DROP COLUMN "paymentVerifiedBy",
DROP COLUMN "paymentVerifiedById",
DROP COLUMN "preparedBy",
DROP COLUMN "proofReceivedAt",
DROP COLUMN "proofReceivedBy",
DROP COLUMN "proofReceivedById",
ADD COLUMN     "activePaymentId" TEXT,
ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedInvoicerId" TEXT,
ADD COLUMN     "billingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "billingEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "billingLastActivityAt" TIMESTAMP(3),
ADD COLUMN     "billingPriority" "BillingPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "billingQueueEnteredAt" TIMESTAMP(3),
ADD COLUMN     "billingReleasedAt" TIMESTAMP(3),
ADD COLUMN     "billingSlaDeadlineAt" TIMESTAMP(3),
ADD COLUMN     "billingStartedAt" TIMESTAMP(3),
ADD COLUMN     "billingWorkStatus" "BillingWorkStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "lastWhatsappMessageId" TEXT,
ADD COLUMN     "lastWhatsappStatus" TEXT,
ADD COLUMN     "lastWhatsappStatusAt" TIMESTAMP(3),
ADD COLUMN     "manualPaymentProofNote" TEXT,
ADD COLUMN     "manualPaymentProofUrl" TEXT,
ADD COLUMN     "manualPaymentReceivedAt" TIMESTAMP(3),
ADD COLUMN     "manualPaymentReference" TEXT,
ADD COLUMN     "manualPaymentValidatedAt" TIMESTAMP(3),
ADD COLUMN     "manualPaymentValidatedById" TEXT,
ADD COLUMN     "paymentLinkClickCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentLinkClickedAt" TIMESTAMP(3),
ADD COLUMN     "paymentProvider" "PaymentProvider",
ADD COLUMN     "paymentStatus" "OrderPaymentStatus" NOT NULL DEFAULT 'UNPAID';

-- AlterTable
ALTER TABLE "PreorderLog" ADD COLUMN     "actorAdminId" TEXT;

-- DropEnum
DROP TYPE "PaymentMode";

-- CreateTable
CREATE TABLE "OrderMessage" (
    "id" TEXT NOT NULL,
    "preorderId" TEXT NOT NULL,
    "channel" "OrderMessageChannel" NOT NULL DEFAULT 'WHATSAPP',
    "purpose" "OrderMessagePurpose" NOT NULL,
    "status" "OrderMessageStatus" NOT NULL DEFAULT 'DRAFT',
    "toPhone" TEXT,
    "body" TEXT,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "paymentLinkTracked" TEXT,
    "paymentLinkTarget" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastStatusAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderMessageEvent" (
    "id" TEXT NOT NULL,
    "orderMessageId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rawPayload" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderMessageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "preorderId" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "methodType" "PaymentMethodType" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "amountExpectedFcfa" INTEGER NOT NULL,
    "amountPaidFcfa" INTEGER NOT NULL DEFAULT 0,
    "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'XOF',
    "providerAccountId" TEXT,
    "lastAttemptId" TEXT,
    "providerReference" TEXT,
    "providerTxnId" TEXT,
    "clientReference" TEXT,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "providerSessionId" TEXT,
    "providerTransactionId" TEXT,
    "checkoutUrl" TEXT,
    "deepLink" TEXT,
    "providerLaunchUrl" TEXT,
    "qrPayload" TEXT,
    "requestPayloadJson" JSONB,
    "responsePayloadJson" JSONB,
    "normalizedPayloadJson" JSONB,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProviderAccount" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "label" TEXT NOT NULL,
    "status" "ProviderAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "merchantIdentifier" TEXT,
    "apiBaseUrl" TEXT DEFAULT 'https://api.wave.com',
    "configEncrypted" TEXT NOT NULL,
    "supportsCheckout" BOOLEAN NOT NULL DEFAULT true,
    "supportsWebhook" BOOLEAN NOT NULL DEFAULT true,
    "supportsRefund" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProviderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProviderRule" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "methodType" "PaymentMethodType" NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerAccountId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProviderRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerEventId" TEXT,
    "eventType" TEXT,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "processingStatus" "WebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "requestHeadersJson" JSONB,
    "payloadJson" JSONB NOT NULL,
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "amountFcfa" INTEGER NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'XOF',
    "providerRefundRef" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PROCESSING',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderMessage_providerMessageId_key" ON "OrderMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "OrderMessage_preorderId_createdAt_idx" ON "OrderMessage"("preorderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderMessage_status_idx" ON "OrderMessage"("status");

-- CreateIndex
CREATE INDEX "OrderMessage_provider_providerMessageId_idx" ON "OrderMessage"("provider", "providerMessageId");

-- CreateIndex
CREATE INDEX "OrderMessageEvent_orderMessageId_createdAt_idx" ON "OrderMessageEvent"("orderMessageId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_preorderId_idx" ON "Payment"("preorderId");

-- CreateIndex
CREATE INDEX "Payment_countryId_provider_status_idx" ON "Payment"("countryId", "provider", "status");

-- CreateIndex
CREATE INDEX "Payment_providerAccountId_idx" ON "Payment"("providerAccountId");

-- CreateIndex
CREATE INDEX "Payment_lastAttemptId_idx" ON "Payment"("lastAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_providerTxnId_key" ON "Payment"("provider", "providerTxnId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_clientReference_key" ON "Payment"("provider", "clientReference");

-- CreateIndex
CREATE INDEX "PaymentAttempt_paymentId_createdAt_idx" ON "PaymentAttempt"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAttempt_provider_providerSessionId_idx" ON "PaymentAttempt"("provider", "providerSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_provider_providerTransactionId_key" ON "PaymentAttempt"("provider", "providerTransactionId");

-- CreateIndex
CREATE INDEX "PaymentProviderAccount_countryId_provider_status_idx" ON "PaymentProviderAccount"("countryId", "provider", "status");

-- CreateIndex
CREATE INDEX "PaymentProviderRule_countryId_methodType_isActive_priority_idx" ON "PaymentProviderRule"("countryId", "methodType", "isActive", "priority");

-- CreateIndex
CREATE INDEX "PaymentProviderRule_providerAccountId_idx" ON "PaymentProviderRule"("providerAccountId");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_provider_processingStatus_receivedAt_idx" ON "PaymentWebhookEvent"("provider", "processingStatus", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_providerEventId_key" ON "PaymentWebhookEvent"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "PaymentRefund_paymentId_idx" ON "PaymentRefund"("paymentId");

-- CreateIndex
CREATE INDEX "Preorder_paymentStatus_createdAt_idx" ON "Preorder"("paymentStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Preorder_billingWorkStatus_billingPriority_billingQueueEnte_idx" ON "Preorder"("billingWorkStatus", "billingPriority", "billingQueueEnteredAt");

-- CreateIndex
CREATE INDEX "Preorder_assignedInvoicerId_billingWorkStatus_idx" ON "Preorder"("assignedInvoicerId", "billingWorkStatus");

-- CreateIndex
CREATE INDEX "Preorder_billingSlaDeadlineAt_idx" ON "Preorder"("billingSlaDeadlineAt");

-- CreateIndex
CREATE INDEX "Preorder_manualPaymentValidatedById_idx" ON "Preorder"("manualPaymentValidatedById");

-- CreateIndex
CREATE INDEX "Preorder_activePaymentId_idx" ON "Preorder"("activePaymentId");

-- CreateIndex
CREATE INDEX "PreorderLog_actorAdminId_idx" ON "PreorderLog"("actorAdminId");

-- AddForeignKey
ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_preorderId_fkey" FOREIGN KEY ("preorderId") REFERENCES "Preorder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMessageEvent" ADD CONSTRAINT "OrderMessageEvent_orderMessageId_fkey" FOREIGN KEY ("orderMessageId") REFERENCES "OrderMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preorder" ADD CONSTRAINT "Preorder_assignedInvoicerId_fkey" FOREIGN KEY ("assignedInvoicerId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preorder" ADD CONSTRAINT "Preorder_manualPaymentValidatedById_fkey" FOREIGN KEY ("manualPaymentValidatedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preorder" ADD CONSTRAINT "Preorder_activePaymentId_fkey" FOREIGN KEY ("activePaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderLog" ADD CONSTRAINT "PreorderLog_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_preorderId_fkey" FOREIGN KEY ("preorderId") REFERENCES "Preorder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "PaymentProviderAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderAccount" ADD CONSTRAINT "PaymentProviderAccount_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderRule" ADD CONSTRAINT "PaymentProviderRule_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderRule" ADD CONSTRAINT "PaymentProviderRule_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "PaymentProviderAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
