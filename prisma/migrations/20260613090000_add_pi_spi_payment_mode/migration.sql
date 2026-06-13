ALTER TYPE "PreorderPaymentMode" ADD VALUE IF NOT EXISTS 'PI_SPI';

UPDATE "CountrySettings" cs
SET
  "enableEcobankPay" = true,
  "ecobankPayMerchantName" = COALESCE(NULLIF(cs."ecobankPayMerchantName", ''), 'FOREVER LIVING PRODUCTS CI'),
  "ecobankPayMerchantId" = COALESCE(NULLIF(cs."ecobankPayMerchantId", ''), 'edf16237-6b72-4155-831a-f9cb64a30434'),
  "ecobankPayQrImageUrl" = COALESCE(NULLIF(cs."ecobankPayQrImageUrl", ''), '/pi-spi-ci-qr.png'),
  "ecobankPayInstructions" = COALESCE(
    NULLIF(cs."ecobankPayInstructions", ''),
    'Scannez le QR PI SPI Ecobank, vérifiez le bénéficiaire FOREVER LIVING PRODUCTS CI, payez le montant exact, puis déposez la preuve de paiement.'
  )
FROM "Country" c
WHERE cs."countryId" = c."id"
  AND c."code" = 'CIV';
