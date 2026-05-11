ALTER TABLE "CountrySettings"
ADD COLUMN IF NOT EXISTS "fboHelpTopics" JSONB;
