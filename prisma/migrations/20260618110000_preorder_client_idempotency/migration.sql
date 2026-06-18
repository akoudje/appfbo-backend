ALTER TABLE "Preorder" ADD COLUMN "clientDraftKey" TEXT;
ALTER TABLE "Preorder" ADD COLUMN "clientSubmissionKey" TEXT;

CREATE UNIQUE INDEX "Preorder_countryId_clientDraftKey_key" ON "Preorder"("countryId", "clientDraftKey");
CREATE UNIQUE INDEX "Preorder_countryId_clientSubmissionKey_key" ON "Preorder"("countryId", "clientSubmissionKey");
