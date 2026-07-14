CREATE TYPE "As400AutomationMode" AS ENUM ('OBSERVATION', 'ASSISTED', 'AUTOMATIC');

CREATE TYPE "As400RequestStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TYPE "As400RequestAction" AS ENUM ('CREATE_AND_VALIDATE_INVOICE', 'CHECK_INVOICE_STATUS');

CREATE TYPE "As400RequestLogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

CREATE TABLE "As400InvoiceRequest" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "preorderId" TEXT NOT NULL,
    "action" "As400RequestAction" NOT NULL DEFAULT 'CREATE_AND_VALIDATE_INVOICE',
    "mode" "As400AutomationMode" NOT NULL DEFAULT 'OBSERVATION',
    "status" "As400RequestStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "requestedInvoiceReference" TEXT,
    "requestedAmountFcfa" INTEGER,
    "requestedPayload" JSONB,
    "as400InvoiceReference" TEXT,
    "as400OrderReference" TEXT,
    "as400AmountFcfa" INTEGER,
    "as400Validated" BOOLEAN NOT NULL DEFAULT false,
    "as400ValidatedAt" TIMESTAMP(3),
    "spoolFilePath" TEXT,
    "screenSnapshotPath" TEXT,
    "resultPayload" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "humanReason" TEXT,
    "availableForProcessingAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "As400InvoiceRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "As400InvoiceRequestLog" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "level" "As400RequestLogLevel" NOT NULL DEFAULT 'INFO',
    "event" TEXT NOT NULL,
    "message" TEXT,
    "payload" JSONB,
    "actorAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "As400InvoiceRequestLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "As400InvoiceRequest_idempotencyKey_key" ON "As400InvoiceRequest"("idempotencyKey");
CREATE INDEX "As400InvoiceRequest_countryId_status_createdAt_idx" ON "As400InvoiceRequest"("countryId", "status", "createdAt");
CREATE INDEX "As400InvoiceRequest_preorderId_createdAt_idx" ON "As400InvoiceRequest"("preorderId", "createdAt");
CREATE INDEX "As400InvoiceRequest_status_availableForProcessingAt_idx" ON "As400InvoiceRequest"("status", "availableForProcessingAt");
CREATE INDEX "As400InvoiceRequest_lockedAt_idx" ON "As400InvoiceRequest"("lockedAt");
CREATE INDEX "As400InvoiceRequest_createdById_idx" ON "As400InvoiceRequest"("createdById");
CREATE INDEX "As400InvoiceRequest_updatedById_idx" ON "As400InvoiceRequest"("updatedById");

CREATE INDEX "As400InvoiceRequestLog_requestId_createdAt_idx" ON "As400InvoiceRequestLog"("requestId", "createdAt");
CREATE INDEX "As400InvoiceRequestLog_level_createdAt_idx" ON "As400InvoiceRequestLog"("level", "createdAt");
CREATE INDEX "As400InvoiceRequestLog_actorAdminId_idx" ON "As400InvoiceRequestLog"("actorAdminId");

ALTER TABLE "As400InvoiceRequest" ADD CONSTRAINT "As400InvoiceRequest_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "As400InvoiceRequest" ADD CONSTRAINT "As400InvoiceRequest_preorderId_fkey" FOREIGN KEY ("preorderId") REFERENCES "Preorder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "As400InvoiceRequest" ADD CONSTRAINT "As400InvoiceRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "As400InvoiceRequest" ADD CONSTRAINT "As400InvoiceRequest_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "As400InvoiceRequestLog" ADD CONSTRAINT "As400InvoiceRequestLog_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "As400InvoiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "As400InvoiceRequestLog" ADD CONSTRAINT "As400InvoiceRequestLog_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
