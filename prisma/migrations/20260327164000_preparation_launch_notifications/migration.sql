ALTER TYPE "OrderMessagePurpose" ADD VALUE IF NOT EXISTS 'PREPARATION_STARTED';
ALTER TYPE "PreorderLogAction" ADD VALUE IF NOT EXISTS 'LAUNCH_PREPARATION';

ALTER TABLE "Preorder"
ADD COLUMN "preparationLaunchedAt" TIMESTAMP(3),
ADD COLUMN "preparationLaunchedById" TEXT,
ADD COLUMN "pickupSecretCode" TEXT,
ADD COLUMN "parcelNumber" TEXT,
ADD COLUMN "pickupCodeVerifiedAt" TIMESTAMP(3),
ADD COLUMN "pickupCodeVerifiedById" TEXT;

ALTER TABLE "Preorder"
ADD CONSTRAINT "Preorder_preparationLaunchedById_fkey"
FOREIGN KEY ("preparationLaunchedById") REFERENCES "AdminUser"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Preorder"
ADD CONSTRAINT "Preorder_pickupCodeVerifiedById_fkey"
FOREIGN KEY ("pickupCodeVerifiedById") REFERENCES "AdminUser"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Preorder_preparationLaunchedById_idx" ON "Preorder"("preparationLaunchedById");
CREATE INDEX "Preorder_preparationLaunchedAt_idx" ON "Preorder"("preparationLaunchedAt");
CREATE INDEX "Preorder_pickupCodeVerifiedById_idx" ON "Preorder"("pickupCodeVerifiedById");
CREATE UNIQUE INDEX "Preorder_parcelNumber_key" ON "Preorder"("parcelNumber");
