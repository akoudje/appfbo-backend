-- Traçabilité du report manuel d'un billet non scanné (null pour l'émission
-- automatique en masse à la clôture de l'événement).
ALTER TABLE "TicketCredit" ADD COLUMN "issuedById" TEXT;

-- AddForeignKey
ALTER TABLE "TicketCredit" ADD CONSTRAINT "TicketCredit_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
