ALTER TABLE "Preorder"
ADD COLUMN "billingGrade" "Grade",
ADD COLUMN "indicativeTotalFcfa" INTEGER,
ADD COLUMN "computedGradeTotalFcfa" INTEGER,
ADD COLUMN "as400InvoiceTotalFcfa" INTEGER,
ADD COLUMN "billingAdjustmentReason" TEXT,
ADD COLUMN "fulfillmentMode" TEXT,
ADD COLUMN "pickupPointLabel" TEXT,
ADD COLUMN "deliveryCarrier" TEXT;

CREATE TABLE "CashierTransaction" (
    "id" TEXT NOT NULL,
    "preorderId" TEXT NOT NULL,
    "cashierId" TEXT,
    "paymentMode" TEXT NOT NULL,
    "amountExpectedFcfa" INTEGER NOT NULL,
    "amountReceivedFcfa" INTEGER,
    "providerReference" TEXT,
    "payerPhone" TEXT,
    "receiptNumber" TEXT,
    "cashDeskLabel" TEXT,
    "receiptPrintedAt" TIMESTAMP(3),
    "preparationLaunchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashierTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CashierTransaction_preorderId_createdAt_idx" ON "CashierTransaction"("preorderId", "createdAt");
CREATE INDEX "CashierTransaction_cashierId_createdAt_idx" ON "CashierTransaction"("cashierId", "createdAt");
CREATE INDEX "CashierTransaction_paymentMode_createdAt_idx" ON "CashierTransaction"("paymentMode", "createdAt");
CREATE INDEX "CashierTransaction_preparationLaunchedAt_idx" ON "CashierTransaction"("preparationLaunchedAt");

ALTER TABLE "CashierTransaction"
ADD CONSTRAINT "CashierTransaction_preorderId_fkey"
FOREIGN KEY ("preorderId") REFERENCES "Preorder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CashierTransaction"
ADD CONSTRAINT "CashierTransaction_cashierId_fkey"
FOREIGN KEY ("cashierId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
