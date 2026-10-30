-- Règlement d'une précommande par une autre filiale FLP (ex. FLP Burkina) :
-- commande traitée et retirée ici, payée au siège de la filiale.
ALTER TABLE "Preorder" ADD COLUMN "settlementEntity" TEXT;
ALTER TABLE "Preorder" ADD COLUMN "settlementReference" TEXT;
ALTER TABLE "Preorder" ADD COLUMN "settlementMarkedAt" TIMESTAMP(3);
ALTER TABLE "Preorder" ADD COLUMN "settlementMarkedById" TEXT;

-- CreateIndex
CREATE INDEX "Preorder_countryId_settlementEntity_idx" ON "Preorder"("countryId", "settlementEntity");

-- AddForeignKey
ALTER TABLE "Preorder" ADD CONSTRAINT "Preorder_settlementMarkedById_fkey" FOREIGN KEY ("settlementMarkedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterEnum
ALTER TYPE "PreorderLogAction" ADD VALUE 'SETTLEMENT_MARKED';
ALTER TYPE "PreorderLogAction" ADD VALUE 'SETTLEMENT_UNMARKED';
