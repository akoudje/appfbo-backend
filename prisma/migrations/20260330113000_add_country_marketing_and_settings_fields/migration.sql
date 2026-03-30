ALTER TABLE "CountrySettings"
ADD COLUMN IF NOT EXISTS "supportPhone" TEXT,
ADD COLUMN IF NOT EXISTS "pickupAddress" TEXT,
ADD COLUMN IF NOT EXISTS "enableWave" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "enableOrangeMoney" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "enableCash" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "enableDelivery" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "enablePickup" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "currencyLabel" TEXT DEFAULT 'FCFA',
ADD COLUMN IF NOT EXISTS "pricingDisclaimer" TEXT,
ADD COLUMN IF NOT EXISTS "themePrimaryColor" TEXT,
ADD COLUMN IF NOT EXISTS "themeSecondaryColor" TEXT,
ADD COLUMN IF NOT EXISTS "themeDarkColor" TEXT,
ADD COLUMN IF NOT EXISTS "themeLogoPath" TEXT,
ADD COLUMN IF NOT EXISTS "themeSliderEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "themeSidePanelsEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "CountryMarketingContent" (
  "id" TEXT NOT NULL,
  "countryId" TEXT NOT NULL,
  "slidesJson" JSONB,
  "sidePanelsJson" JSONB,
  "publishingJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CountryMarketingContent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CountryMarketingContent_countryId_key"
ON "CountryMarketingContent"("countryId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'CountryMarketingContent_countryId_fkey'
  ) THEN
    ALTER TABLE "CountryMarketingContent"
    ADD CONSTRAINT "CountryMarketingContent_countryId_fkey"
    FOREIGN KEY ("countryId") REFERENCES "Country"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
