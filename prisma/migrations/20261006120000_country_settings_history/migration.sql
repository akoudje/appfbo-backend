CREATE TABLE "CountrySettingsChange" (
 "id" TEXT NOT NULL,
 "countryId" TEXT NOT NULL,
 "actorId" TEXT,
 "actorLabel" TEXT NOT NULL,
 "changes" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CountrySettingsChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CountrySettingsChange_countryId_createdAt_idx" ON "CountrySettingsChange"("countryId", "createdAt");
ALTER TABLE "CountrySettingsChange" ADD CONSTRAINT "CountrySettingsChange_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;
