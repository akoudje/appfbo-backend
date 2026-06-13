UPDATE "CountrySettings" cs
SET "piSpiQrImageUrl" = '/QR%20code%20pi%20spi.png'
FROM "Country" c
WHERE cs."countryId" = c."id"
  AND c."code" = 'CIV'
  AND (
    cs."piSpiQrImageUrl" IS NULL
    OR NULLIF(cs."piSpiQrImageUrl", '') IS NULL
    OR cs."piSpiQrImageUrl" = '/pi-spi-ci-qr.png'
  );
