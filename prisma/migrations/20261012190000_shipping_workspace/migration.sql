ALTER TABLE "Preorder"
  ADD COLUMN "shippingHandedOverAt" TIMESTAMP(3),
  ADD COLUMN "shippingReceiptFileUrl" TEXT,
  ADD COLUMN "shippingReceiptMimeType" TEXT;
CREATE INDEX "Preorder_countryId_deliveryMode_status_idx" ON "Preorder"("countryId", "deliveryMode", "status");
