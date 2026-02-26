-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('NON_CLASSE', 'BUVABLE', 'COMBO_PACKS', 'GESTION_DE_POIDS', 'NUTRITION', 'PRODUIT_DE_LA_ROCHE', 'SOINS_DE_LA_PEAU', 'SOINS_PERSONNELS');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "category" "ProductCategory" NOT NULL DEFAULT 'NON_CLASSE',
ADD COLUMN     "details" TEXT,
ADD COLUMN     "stockQty" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");
