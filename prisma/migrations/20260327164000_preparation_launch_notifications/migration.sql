ALTER TYPE "OrderMessagePurpose" ADD VALUE IF NOT EXISTS 'PREPARATION_STARTED';
ALTER TYPE "PreorderLogAction" ADD VALUE IF NOT EXISTS 'LAUNCH_PREPARATION';

ALTER TABLE "Preorder"
ADD COLUMN "preparationLaunchedAt" TIMESTAMP(3),
ADD COLUMN "preparationLaunchedById" TEXT,
ADD COLUMN "pickupSecretCode" TEXT;

ALTER TABLE "Preorder"
ADD CONSTRAINT "Preorder_preparationLaunchedById_fkey"
FOREIGN KEY ("preparationLaunchedById") REFERENCES "AdminUser"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Preorder_preparationLaunchedById_idx" ON "Preorder"("preparationLaunchedById");
CREATE INDEX "Preorder_preparationLaunchedAt_idx" ON "Preorder"("preparationLaunchedAt");
