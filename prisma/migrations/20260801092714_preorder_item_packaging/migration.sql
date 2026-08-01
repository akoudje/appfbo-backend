-- AlterTable
ALTER TABLE "PreorderItem" ADD COLUMN     "packagingLabelSnapshot" TEXT,
ADD COLUMN     "packagingQty" INTEGER,
ADD COLUMN     "packagingUnitsPerPackage" INTEGER,
ADD COLUMN     "productPackagingId" TEXT;

-- CreateIndex
CREATE INDEX "PreorderItem_productPackagingId_idx" ON "PreorderItem"("productPackagingId");

-- AddForeignKey
ALTER TABLE "PreorderItem" ADD CONSTRAINT "PreorderItem_productPackagingId_fkey" FOREIGN KEY ("productPackagingId") REFERENCES "ProductPackaging"("id") ON DELETE SET NULL ON UPDATE CASCADE;
