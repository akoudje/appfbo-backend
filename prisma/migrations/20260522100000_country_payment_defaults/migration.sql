UPDATE "CountrySettings" cs
SET
  "enableWave" = true,
  "enableEcobankPay" = false
FROM "Country" c
WHERE cs."countryId" = c."id"
  AND c."code" = 'CIV';

UPDATE "CountrySettings" cs
SET
  "enableWave" = false,
  "enableEcobankPay" = true,
  "ecobankPayMerchantName" = COALESCE(cs."ecobankPayMerchantName", 'FOREVER LIVING PRODUCT BF'),
  "ecobankPayMerchantId" = COALESCE(cs."ecobankPayMerchantId", '858172371'),
  "ecobankPayTerminalName" = COALESCE(cs."ecobankPayTerminalName", 'FOREVER LIVING PRODUCT BF'),
  "ecobankPayTerminalId" = COALESCE(cs."ecobankPayTerminalId", '32629497'),
  "ecobankPayInstructions" = COALESCE(
    cs."ecobankPayInstructions",
    'Scannez le QR Ecobank Pay FOREVER Burkina Faso, payez le montant exact de la facture, puis déposez une capture ou un justificatif de paiement.'
  )
FROM "Country" c
WHERE cs."countryId" = c."id"
  AND c."code" = 'BFA';
