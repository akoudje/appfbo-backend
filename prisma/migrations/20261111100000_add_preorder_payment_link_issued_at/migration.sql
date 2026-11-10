-- Date d’émission du dernier lien de paiement Wave d’une précommande : seul ce
-- lien est valable, pendant 3 h. Colonne nullable, aucune donnée existante modifiée.
ALTER TABLE "Preorder" ADD COLUMN "paymentLinkIssuedAt" TIMESTAMP(3);
