-- Payeur tiers de l'achat de parrainage (notifications de paiement en plus du parrain).
ALTER TABLE "Sponsorship" ADD COLUMN "purchasePayerName" TEXT;
ALTER TABLE "Sponsorship" ADD COLUMN "purchasePayerPhone" TEXT;
ALTER TABLE "Sponsorship" ADD COLUMN "purchasePayerEmail" TEXT;
