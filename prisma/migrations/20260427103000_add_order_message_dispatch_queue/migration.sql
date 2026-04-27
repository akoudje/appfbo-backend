-- Add retry/dispatch queue fields to OrderMessage
ALTER TABLE "OrderMessage"
ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN "processingStartedAt" TIMESTAMP(3);

CREATE INDEX "OrderMessage_channel_status_nextAttemptAt_idx"
ON "OrderMessage"("channel", "status", "nextAttemptAt");
