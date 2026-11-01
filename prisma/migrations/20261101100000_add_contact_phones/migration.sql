-- Coordonnées internationales : téléphone et WhatsApp sur la fiche FBO
-- (saisis une fois, réutilisés), WhatsApp de contact sur la commande.
ALTER TABLE "Fbo" ADD COLUMN "phone" TEXT;
ALTER TABLE "Fbo" ADD COLUMN "whatsappPhone" TEXT;
ALTER TABLE "Fbo" ADD COLUMN "whatsappOptInAt" TIMESTAMP(3);
ALTER TABLE "Preorder" ADD COLUMN "contactWhatsapp" TEXT;
ALTER TABLE "Sponsorship" ADD COLUMN "whatsapp" TEXT;
