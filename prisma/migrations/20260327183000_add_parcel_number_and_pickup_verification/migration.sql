ALTER TABLE "Preorder"
ADD COLUMN IF NOT EXISTS "parcelNumber" TEXT,
ADD COLUMN IF NOT EXISTS "pickupCodeVerifiedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "pickupCodeVerifiedById" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Preorder_pickupCodeVerifiedById_fkey'
  ) THEN
    ALTER TABLE "Preorder"
    ADD CONSTRAINT "Preorder_pickupCodeVerifiedById_fkey"
    FOREIGN KEY ("pickupCodeVerifiedById") REFERENCES "AdminUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Preorder_pickupCodeVerifiedById_idx"
ON "Preorder"("pickupCodeVerifiedById");

CREATE UNIQUE INDEX IF NOT EXISTS "Preorder_parcelNumber_key"
ON "Preorder"("parcelNumber");
