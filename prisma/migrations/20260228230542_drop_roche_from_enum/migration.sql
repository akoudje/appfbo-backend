/*
  Warnings:

  - The values [PRODUIT_DE_LA_ROCHE] on the enum `ProductCategory` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ProductCategory_new" AS ENUM ('NON_CLASSE', 'BUVABLE', 'COMBO_PACKS', 'GESTION_DE_POIDS', 'NUTRITION', 'PRODUIT_DE_LA_RUCHE', 'SOINS_DE_LA_PEAU', 'SOINS_PERSONNELS');
ALTER TABLE "Product" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "Product" ALTER COLUMN "category" TYPE "ProductCategory_new" USING ("category"::text::"ProductCategory_new");
ALTER TYPE "ProductCategory" RENAME TO "ProductCategory_old";
ALTER TYPE "ProductCategory_new" RENAME TO "ProductCategory";
DROP TYPE "ProductCategory_old";
ALTER TABLE "Product" ALTER COLUMN "category" SET DEFAULT 'NON_CLASSE';
COMMIT;
