CREATE TABLE IF NOT EXISTS "CustomerNotificationRead" (
  "id" TEXT NOT NULL,
  "fboId" TEXT NOT NULL,
  "notificationKey" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerNotificationRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerNotificationRead_fboId_notificationKey_key"
ON "CustomerNotificationRead"("fboId", "notificationKey");

CREATE INDEX IF NOT EXISTS "CustomerNotificationRead_fboId_readAt_idx"
ON "CustomerNotificationRead"("fboId", "readAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CustomerNotificationRead_fboId_fkey'
  ) THEN
    ALTER TABLE "CustomerNotificationRead"
    ADD CONSTRAINT "CustomerNotificationRead_fboId_fkey"
    FOREIGN KEY ("fboId") REFERENCES "Fbo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
