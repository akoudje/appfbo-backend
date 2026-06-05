ALTER TABLE "Preorder" ADD COLUMN "paymentExpiresAt" TIMESTAMP(3);

CREATE INDEX "Preorder_paymentExpiresAt_idx" ON "Preorder"("paymentExpiresAt");
