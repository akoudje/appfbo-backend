/*
  Warnings:

  - A unique constraint covering the columns `[preorderNumber]` on the table `Preorder` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Preorder" ADD COLUMN     "preorderDateKey" TEXT,
ADD COLUMN     "preorderNumber" TEXT,
ADD COLUMN     "preorderSeq" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Preorder_preorderNumber_key" ON "Preorder"("preorderNumber");
