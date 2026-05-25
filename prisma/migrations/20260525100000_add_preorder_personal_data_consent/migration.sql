ALTER TABLE "Preorder"
ADD COLUMN "personalDataConsentAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "personalDataConsentAcceptedAt" TIMESTAMP(3),
ADD COLUMN "personalDataConsentVersion" TEXT;
