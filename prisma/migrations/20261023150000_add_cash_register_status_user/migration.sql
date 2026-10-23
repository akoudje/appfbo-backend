-- CashRegisterStatus devient une caisse personnelle par facturier caissier,
-- plutôt qu'un seul interrupteur global par pays : userId NULL = caisse
-- globale du comptoir (responsables, modèle classique CAISSIERE/INVOICER),
-- userId non-NULL = caisse personnelle d'un facturier caissier. Pas de
-- contrainte unique sur (countryId, userId) : Postgres autorise plusieurs
-- NULL sur un couple UNIQUE, donc l'unicité de la ligne globale est garantie
-- côté applicatif (find-puis-create), pas en base.

-- DropIndex
DROP INDEX "CashRegisterStatus_countryId_key";

-- AlterTable
ALTER TABLE "CashRegisterStatus" ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE INDEX "CashRegisterStatus_countryId_userId_idx" ON "CashRegisterStatus"("countryId", "userId");

-- AddForeignKey
ALTER TABLE "CashRegisterStatus" ADD CONSTRAINT "CashRegisterStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
