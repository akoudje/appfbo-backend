ALTER TYPE "DeliveryMode" ADD VALUE IF NOT EXISTS 'EXPEDITION_POSTE';
ALTER TYPE "DeliveryMode" ADD VALUE IF NOT EXISTS 'EXPEDITION_CODITRANS';

ALTER TABLE "Preorder"
  ADD COLUMN "shippingRecipientName" TEXT,
  ADD COLUMN "shippingRecipientPhone" TEXT,
  ADD COLUMN "shippingDestinationCity" TEXT,
  ADD COLUMN "shippingFeeFcfa" INTEGER,
  ADD COLUMN "shippingWeightKg" DECIMAL(12,3),
  ADD COLUMN "shippingParcelCount" INTEGER,
  ADD COLUMN "shippingQuotedAt" TIMESTAMP(3),
  ADD COLUMN "shippingQuotedById" TEXT,
  ADD COLUMN "shippingPaymentLinkId" TEXT;

CREATE UNIQUE INDEX "Preorder_shippingPaymentLinkId_key" ON "Preorder"("shippingPaymentLinkId");
ALTER TABLE "Preorder" ADD CONSTRAINT "Preorder_shippingPaymentLinkId_fkey"
  FOREIGN KEY ("shippingPaymentLinkId") REFERENCES "ExternalPaymentLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Preorder" ADD CONSTRAINT "Preorder_shipping_amount_check" CHECK ("shippingFeeFcfa" IS NULL OR "shippingFeeFcfa" >= 0);
