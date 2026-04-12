-- Add dedicated payment collection code for online preorders
ALTER TABLE "Preorder"
ADD COLUMN "paymentCollectionCode" TEXT;

CREATE INDEX "Preorder_paymentCollectionCode_idx"
ON "Preorder"("paymentCollectionCode");
