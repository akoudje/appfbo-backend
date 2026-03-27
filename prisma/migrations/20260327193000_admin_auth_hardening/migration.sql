ALTER TABLE "AdminUser"
ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "AdminUser_lockedUntil_idx"
ON "AdminUser"("lockedUntil");

CREATE TABLE IF NOT EXISTS "AdminUserAuditLog" (
  "id" TEXT NOT NULL,
  "actorAdminId" TEXT,
  "targetAdminId" TEXT,
  "action" TEXT NOT NULL,
  "note" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminUserAuditLog_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'AdminUserAuditLog_actorAdminId_fkey'
  ) THEN
    ALTER TABLE "AdminUserAuditLog"
    ADD CONSTRAINT "AdminUserAuditLog_actorAdminId_fkey"
    FOREIGN KEY ("actorAdminId") REFERENCES "AdminUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'AdminUserAuditLog_targetAdminId_fkey'
  ) THEN
    ALTER TABLE "AdminUserAuditLog"
    ADD CONSTRAINT "AdminUserAuditLog_targetAdminId_fkey"
    FOREIGN KEY ("targetAdminId") REFERENCES "AdminUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "AdminUserAuditLog_actorAdminId_createdAt_idx"
ON "AdminUserAuditLog"("actorAdminId", "createdAt");

CREATE INDEX IF NOT EXISTS "AdminUserAuditLog_targetAdminId_createdAt_idx"
ON "AdminUserAuditLog"("targetAdminId", "createdAt");

CREATE INDEX IF NOT EXISTS "AdminUserAuditLog_action_createdAt_idx"
ON "AdminUserAuditLog"("action", "createdAt");
