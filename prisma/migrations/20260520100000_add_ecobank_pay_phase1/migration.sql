ALTER TYPE "PreorderPaymentMode" ADD VALUE IF NOT EXISTS 'ECOBANK_PAY';

ALTER TABLE "CountrySettings"
  ADD COLUMN IF NOT EXISTS "enableEcobankPay" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "ecobankPayMerchantName" TEXT,
  ADD COLUMN IF NOT EXISTS "ecobankPayMerchantId" TEXT,
  ADD COLUMN IF NOT EXISTS "ecobankPayTerminalName" TEXT,
  ADD COLUMN IF NOT EXISTS "ecobankPayTerminalId" TEXT,
  ADD COLUMN IF NOT EXISTS "ecobankPayQrImageUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "ecobankPayInstructions" TEXT;

UPDATE "CountrySettings" cs
SET
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
