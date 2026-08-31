-- Politique de sanction pour non-retrait de colis : nouvelles valeurs
-- d'enum pour tracer les rappels/signalements automatiques du scheduler
-- pickup-overdue.service.js dans PreorderLog, et champs pour l'éventuelle
-- pénalité de stockage enregistrée manuellement par un admin depuis la
-- liste des colis en retard (aucun prélèvement automatique : voir
-- pickup-overdue.service.js).

ALTER TYPE "PreorderLogAction" ADD VALUE 'PICKUP_REMINDER_SENT';
ALTER TYPE "PreorderLogAction" ADD VALUE 'PICKUP_OVERDUE_FLAGGED';
ALTER TYPE "PreorderLogAction" ADD VALUE 'PICKUP_PENALTY_APPLIED';

ALTER TABLE "Preorder" ADD COLUMN "pickupPenaltyFcfa" INTEGER;
ALTER TABLE "Preorder" ADD COLUMN "pickupPenaltyNote" TEXT;
ALTER TABLE "Preorder" ADD COLUMN "pickupPenaltyAppliedAt" TIMESTAMP(3);
ALTER TABLE "Preorder" ADD COLUMN "pickupPenaltyAppliedById" TEXT;

ALTER TABLE "Preorder" ADD CONSTRAINT "Preorder_pickupPenaltyAppliedById_fkey" FOREIGN KEY ("pickupPenaltyAppliedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Preorder_pickupPenaltyAppliedById_idx" ON "Preorder"("pickupPenaltyAppliedById");
CREATE INDEX "Preorder_status_preparedAt_idx" ON "Preorder"("status", "preparedAt");
