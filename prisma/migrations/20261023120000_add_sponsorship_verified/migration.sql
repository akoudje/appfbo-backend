-- Sponsorship.sponsorVerified : false quand le numéro FBO du parrain n'était
-- pas reconnu par l'annuaire au moment de la soumission (fiche publique
-- auto-déclarée, ou saisie au comptoir sans fiche locale). Défaut true pour
-- ne pas marquer rétroactivement les parrainages existants comme suspects.
ALTER TABLE "Sponsorship" ADD COLUMN "sponsorVerified" BOOLEAN NOT NULL DEFAULT true;
