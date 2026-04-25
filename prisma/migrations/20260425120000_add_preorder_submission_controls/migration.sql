-- Add country-level soft freeze for preorder submissions
ALTER TABLE "CountrySettings"
ADD COLUMN "preorderSubmissionEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "preorderSubmissionDisabledMessage" TEXT;
