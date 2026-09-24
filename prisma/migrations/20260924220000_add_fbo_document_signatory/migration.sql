-- CreateTable
CREATE TABLE "FboDocumentSignatory" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "civility" "SignatoryCivility" NOT NULL DEFAULT 'MME',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FboDocumentSignatory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FboDocumentSignatory_countryId_active_sortOrder_idx" ON "FboDocumentSignatory"("countryId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "FboDocumentSignatory_countryId_name_title_key" ON "FboDocumentSignatory"("countryId", "name", "title");

-- AddForeignKey
ALTER TABLE "FboDocumentSignatory" ADD CONSTRAINT "FboDocumentSignatory_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;
