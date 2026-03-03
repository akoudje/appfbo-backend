-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'TECH_ADMIN', 'OPERATIONS_DIRECTOR', 'SALES_DIRECTOR', 'BILLING_MANAGER', 'MARKETING_ASSISTANT', 'STOCK_MANAGER', 'COUNTER_MANAGER', 'INVOICER', 'ORDER_PREPARER');

-- AlterTable
ALTER TABLE "Preorder" ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "fulfilledById" TEXT,
ADD COLUMN     "invoicedById" TEXT,
ADD COLUMN     "paymentVerifiedById" TEXT,
ADD COLUMN     "preparedById" TEXT,
ADD COLUMN     "proofReceivedById" TEXT;

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "fullName" TEXT,
    "role" "AdminRole" NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "countryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FboCountry" (
    "id" TEXT NOT NULL,
    "fboId" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "pointDeVente" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FboCountry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "AdminUser_countryId_idx" ON "AdminUser"("countryId");

-- CreateIndex
CREATE INDEX "AdminUser_role_idx" ON "AdminUser"("role");

-- CreateIndex
CREATE INDEX "FboCountry_countryId_idx" ON "FboCountry"("countryId");

-- CreateIndex
CREATE UNIQUE INDEX "FboCountry_fboId_countryId_key" ON "FboCountry"("fboId", "countryId");

-- CreateIndex
CREATE INDEX "Preorder_invoicedById_idx" ON "Preorder"("invoicedById");

-- CreateIndex
CREATE INDEX "Preorder_proofReceivedById_idx" ON "Preorder"("proofReceivedById");

-- CreateIndex
CREATE INDEX "Preorder_paymentVerifiedById_idx" ON "Preorder"("paymentVerifiedById");

-- CreateIndex
CREATE INDEX "Preorder_preparedById_idx" ON "Preorder"("preparedById");

-- CreateIndex
CREATE INDEX "Preorder_fulfilledById_idx" ON "Preorder"("fulfilledById");

-- CreateIndex
CREATE INDEX "Preorder_cancelledById_idx" ON "Preorder"("cancelledById");

-- AddForeignKey
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FboCountry" ADD CONSTRAINT "FboCountry_fboId_fkey" FOREIGN KEY ("fboId") REFERENCES "Fbo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FboCountry" ADD CONSTRAINT "FboCountry_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preorder" ADD CONSTRAINT "Preorder_invoicedById_fkey" FOREIGN KEY ("invoicedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preorder" ADD CONSTRAINT "Preorder_proofReceivedById_fkey" FOREIGN KEY ("proofReceivedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preorder" ADD CONSTRAINT "Preorder_paymentVerifiedById_fkey" FOREIGN KEY ("paymentVerifiedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preorder" ADD CONSTRAINT "Preorder_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preorder" ADD CONSTRAINT "Preorder_fulfilledById_fkey" FOREIGN KEY ("fulfilledById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preorder" ADD CONSTRAINT "Preorder_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

