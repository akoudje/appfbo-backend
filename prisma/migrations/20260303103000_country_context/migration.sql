-- CreateTable
CREATE TABLE IF NOT EXISTS "Country" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currencyCode" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CountrySettings" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "minCartFcfa" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CountrySettings_pkey" PRIMARY KEY ("id")
);

-- Create default country CI (safe if already present)
INSERT INTO "Country" ("id", "code", "name", "currencyCode", "actif", "createdAt", "updatedAt")
SELECT 'country_ci_default', 'CI', 'Cote d''Ivoire', 'XOF', true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Country" WHERE "code" = 'CI'
);

-- Create default settings for CI
INSERT INTO "CountrySettings" ("id", "countryId", "minCartFcfa", "createdAt", "updatedAt")
SELECT
  'country_settings_ci_default',
  c."id",
  10000,
  NOW(),
  NOW()
FROM "Country" c
WHERE c."code" = 'CI'
AND NOT EXISTS (
  SELECT 1 FROM "CountrySettings" cs WHERE cs."countryId" = c."id"
);

-- Add countryId as nullable for backfill
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "countryId" TEXT;
ALTER TABLE "Preorder" ADD COLUMN IF NOT EXISTS "countryId" TEXT;
ALTER TABLE "GradeDiscount" ADD COLUMN IF NOT EXISTS "countryId" TEXT;

-- Backfill with CI country
UPDATE "Product"
SET "countryId" = c."id"
FROM "Country" c
WHERE c."code" = 'CI' AND "Product"."countryId" IS NULL;

UPDATE "Preorder"
SET "countryId" = c."id"
FROM "Country" c
WHERE c."code" = 'CI' AND "Preorder"."countryId" IS NULL;

UPDATE "GradeDiscount"
SET "countryId" = c."id"
FROM "Country" c
WHERE c."code" = 'CI' AND "GradeDiscount"."countryId" IS NULL;

-- Enforce non-null after backfill
ALTER TABLE "Product" ALTER COLUMN "countryId" SET NOT NULL;
ALTER TABLE "Preorder" ALTER COLUMN "countryId" SET NOT NULL;
ALTER TABLE "GradeDiscount" ALTER COLUMN "countryId" SET NOT NULL;

-- Indexes/uniques
CREATE UNIQUE INDEX IF NOT EXISTS "Country_code_key" ON "Country"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "CountrySettings_countryId_key" ON "CountrySettings"("countryId");
CREATE INDEX IF NOT EXISTS "Product_countryId_idx" ON "Product"("countryId");
CREATE INDEX IF NOT EXISTS "Preorder_countryId_status_createdAt_idx" ON "Preorder"("countryId", "status", "createdAt");
DROP INDEX IF EXISTS "GradeDiscount_grade_key";
CREATE UNIQUE INDEX IF NOT EXISTS "GradeDiscount_countryId_grade_key" ON "GradeDiscount"("countryId", "grade");
CREATE INDEX IF NOT EXISTS "GradeDiscount_countryId_idx" ON "GradeDiscount"("countryId");

-- Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CountrySettings_countryId_fkey'
  ) THEN
    ALTER TABLE "CountrySettings"
    ADD CONSTRAINT "CountrySettings_countryId_fkey"
    FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Product_countryId_fkey'
  ) THEN
    ALTER TABLE "Product"
    ADD CONSTRAINT "Product_countryId_fkey"
    FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Preorder_countryId_fkey'
  ) THEN
    ALTER TABLE "Preorder"
    ADD CONSTRAINT "Preorder_countryId_fkey"
    FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GradeDiscount_countryId_fkey'
  ) THEN
    ALTER TABLE "GradeDiscount"
    ADD CONSTRAINT "GradeDiscount_countryId_fkey"
    FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;
