-- Track AS400 certification disputes opened by cashiers when a paid invoice
-- cannot be found in the certification application.
ALTER TABLE "Preorder"
ADD COLUMN "billingEscalationType" TEXT,
ADD COLUMN "as400CertificationStatus" TEXT,
ADD COLUMN "as400CertificationReportedAt" TIMESTAMP(3),
ADD COLUMN "as400CertificationReportedById" TEXT,
ADD COLUMN "as400CertificationResolvedAt" TIMESTAMP(3),
ADD COLUMN "as400CertificationResolvedById" TEXT,
ADD COLUMN "as400CertificationNote" TEXT;

CREATE INDEX "Preorder_billingEscalationType_as400CertificationStatus_idx"
ON "Preorder"("billingEscalationType", "as400CertificationStatus");

CREATE INDEX "Preorder_as400CertificationReportedAt_idx"
ON "Preorder"("as400CertificationReportedAt");
