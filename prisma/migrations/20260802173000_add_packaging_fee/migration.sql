-- AlterTable
ALTER TABLE "CountrySettings" ADD COLUMN     "packagingFeeFcfa" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "Preorder" ADD COLUMN     "emballageFcfa" INTEGER NOT NULL DEFAULT 0;
