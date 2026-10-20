ALTER TABLE "Preorder" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Preorder_countryId_isTest_idx" ON "Preorder"("countryId", "isTest");
