-- CreateEnum
CREATE TYPE "CashClosureStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "CashClosure" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "submittedById" TEXT,
    "reviewedById" TEXT,
    "dateKey" TEXT NOT NULL,
    "status" "CashClosureStatus" NOT NULL DEFAULT 'DRAFT',
    "totalExpectedFcfa" INTEGER NOT NULL DEFAULT 0,
    "totalDeclaredFcfa" INTEGER NOT NULL DEFAULT 0,
    "discrepancyFcfa" INTEGER NOT NULL DEFAULT 0,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "reviewNote" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashClosureLine" (
    "id" TEXT NOT NULL,
    "closureId" TEXT NOT NULL,
    "paymentMode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "expectedFcfa" INTEGER NOT NULL DEFAULT 0,
    "declaredFcfa" INTEGER NOT NULL DEFAULT 0,
    "discrepancyFcfa" INTEGER NOT NULL DEFAULT 0,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashClosureLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashClosure_countryId_cashierId_dateKey_key" ON "CashClosure"("countryId", "cashierId", "dateKey");

-- CreateIndex
CREATE INDEX "CashClosure_countryId_dateKey_idx" ON "CashClosure"("countryId", "dateKey");

-- CreateIndex
CREATE INDEX "CashClosure_cashierId_dateKey_idx" ON "CashClosure"("cashierId", "dateKey");

-- CreateIndex
CREATE INDEX "CashClosure_status_dateKey_idx" ON "CashClosure"("status", "dateKey");

-- CreateIndex
CREATE UNIQUE INDEX "CashClosureLine_closureId_paymentMode_key" ON "CashClosureLine"("closureId", "paymentMode");

-- CreateIndex
CREATE INDEX "CashClosureLine_paymentMode_idx" ON "CashClosureLine"("paymentMode");

-- AddForeignKey
ALTER TABLE "CashClosure" ADD CONSTRAINT "CashClosure_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashClosure" ADD CONSTRAINT "CashClosure_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashClosure" ADD CONSTRAINT "CashClosure_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashClosure" ADD CONSTRAINT "CashClosure_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashClosureLine" ADD CONSTRAINT "CashClosureLine_closureId_fkey" FOREIGN KEY ("closureId") REFERENCES "CashClosure"("id") ON DELETE CASCADE ON UPDATE CASCADE;
