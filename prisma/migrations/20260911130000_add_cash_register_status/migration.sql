-- CreateTable
CREATE TABLE "CashRegisterStatus" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "closedMessage" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashRegisterStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashRegisterStatus_countryId_key" ON "CashRegisterStatus"("countryId");

-- AddForeignKey
ALTER TABLE "CashRegisterStatus" ADD CONSTRAINT "CashRegisterStatus_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRegisterStatus" ADD CONSTRAINT "CashRegisterStatus_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRegisterStatus" ADD CONSTRAINT "CashRegisterStatus_reopenedById_fkey" FOREIGN KEY ("reopenedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
