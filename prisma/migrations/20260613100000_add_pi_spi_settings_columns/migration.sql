ALTER TABLE "CountrySettings"
  ADD COLUMN IF NOT EXISTS "enablePiSpi" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "piSpiAlias" TEXT,
  ADD COLUMN IF NOT EXISTS "piSpiMerchantName" TEXT,
  ADD COLUMN IF NOT EXISTS "piSpiQrImageUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "piSpiInstructions" TEXT;

UPDATE "CountrySettings" cs
SET
  "enablePiSpi" = true,
  "piSpiMerchantName" = COALESCE(NULLIF(cs."piSpiMerchantName", ''), 'FOREVER LIVING PRODUCTS CI'),
  "piSpiAlias" = COALESCE(NULLIF(cs."piSpiAlias", ''), 'edf16237-6b72-4155-831a-f9cb64a30434'),
  "piSpiQrImageUrl" = COALESCE(NULLIF(cs."piSpiQrImageUrl", ''), '/pi-spi-ci-qr.png'),
  "piSpiInstructions" = COALESCE(
    NULLIF(cs."piSpiInstructions", ''),
    'Scannez le QR PI SPI Ecobank, vérifiez le bénéficiaire FOREVER LIVING PRODUCTS CI, payez le montant exact, puis déposez la preuve de paiement.'
  )
FROM "Country" c
WHERE cs."countryId" = c."id"
  AND c."code" = 'CIV';
