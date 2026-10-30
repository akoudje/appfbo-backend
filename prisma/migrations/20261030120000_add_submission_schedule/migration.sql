-- Horaire hebdomadaire de fermeture/ouverture automatique des soumissions
-- client, par pays, et exception du jour (prolongation, fermeture manuelle).
ALTER TABLE "CountrySettings" ADD COLUMN "submissionScheduleEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CountrySettings" ADD COLUMN "submissionSchedule" JSONB;
ALTER TABLE "CountrySettings" ADD COLUMN "submissionGraceMinutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "CountrySettings" ADD COLUMN "submissionOverride" JSONB;
