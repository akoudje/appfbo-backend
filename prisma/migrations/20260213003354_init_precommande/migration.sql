-- CreateEnum
CREATE TYPE "Grade" AS ENUM ('ASSOCIATE', 'ASSISTANT_SUPERVISOR', 'SUPERVISOR', 'ASSISTANT_MANAGER', 'MANAGER', 'SENIOR_MANAGER', 'DIRECTOR', 'SENIOR_DIRECTOR', 'EXECUTIVE', 'SAPPHIRE', 'DIAMOND_SAPPHIRE', 'DIAMOND', 'SOARING_MANAGER');

-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('RETRAIT_SITE_FLP', 'LIVRAISON');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('WAVE', 'ORANGE_MONEY', 'MTN_MONEY', 'MOOV_MONEY', 'CASH', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "PreorderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'INVOICED', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "Fbo" (
    "id" TEXT NOT NULL,
    "numeroFbo" TEXT NOT NULL,
    "nomComplet" TEXT NOT NULL,
    "grade" "Grade" NOT NULL,
    "pointDeVente" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fbo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "imageUrl" TEXT,
    "prixBaseFcfa" INTEGER NOT NULL,
    "cc" DECIMAL(10,3) NOT NULL,
    "poidsKg" DECIMAL(10,3) NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeDiscount" (
    "id" TEXT NOT NULL,
    "grade" "Grade" NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradeDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Preorder" (
    "id" TEXT NOT NULL,
    "status" "PreorderStatus" NOT NULL DEFAULT 'DRAFT',
    "fboId" TEXT NOT NULL,
    "fboNumero" TEXT NOT NULL,
    "fboNomComplet" TEXT NOT NULL,
    "fboGrade" "Grade" NOT NULL,
    "pointDeVente" TEXT NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL,
    "deliveryMode" "DeliveryMode" NOT NULL,
    "totalCc" DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    "totalPoidsKg" DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    "totalProduitsFcfa" INTEGER NOT NULL DEFAULT 0,
    "fraisLivraisonFcfa" INTEGER NOT NULL DEFAULT 0,
    "totalFcfa" INTEGER NOT NULL DEFAULT 0,
    "whatsappMessage" TEXT,
    "factureReference" TEXT,
    "factureWhatsappTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Preorder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreorderItem" (
    "id" TEXT NOT NULL,
    "preorderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "prixUnitaireFcfa" INTEGER NOT NULL,
    "ccUnitaire" DECIMAL(10,3) NOT NULL,
    "poidsUnitaireKg" DECIMAL(10,3) NOT NULL,
    "lineTotalFcfa" INTEGER NOT NULL,
    "lineTotalCc" DECIMAL(12,3) NOT NULL,
    "lineTotalPoids" DECIMAL(12,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreorderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Fbo_numeroFbo_key" ON "Fbo"("numeroFbo");

-- CreateIndex
CREATE INDEX "Fbo_pointDeVente_idx" ON "Fbo"("pointDeVente");

-- CreateIndex
CREATE INDEX "Fbo_grade_idx" ON "Fbo"("grade");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_actif_idx" ON "Product"("actif");

-- CreateIndex
CREATE INDEX "Product_nom_idx" ON "Product"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "GradeDiscount_grade_key" ON "GradeDiscount"("grade");

-- CreateIndex
CREATE INDEX "Preorder_status_createdAt_idx" ON "Preorder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Preorder_fboId_idx" ON "Preorder"("fboId");

-- CreateIndex
CREATE INDEX "Preorder_pointDeVente_idx" ON "Preorder"("pointDeVente");

-- CreateIndex
CREATE INDEX "PreorderItem_productId_idx" ON "PreorderItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PreorderItem_preorderId_productId_key" ON "PreorderItem"("preorderId", "productId");

-- AddForeignKey
ALTER TABLE "Preorder" ADD CONSTRAINT "Preorder_fboId_fkey" FOREIGN KEY ("fboId") REFERENCES "Fbo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderItem" ADD CONSTRAINT "PreorderItem_preorderId_fkey" FOREIGN KEY ("preorderId") REFERENCES "Preorder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderItem" ADD CONSTRAINT "PreorderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
