ALTER TABLE "CountrySettings"
  ALTER COLUMN "maxActiveBillingPerInvoicer" SET DEFAULT 10,
  ALTER COLUMN "billingClaimTimeoutMin" SET DEFAULT 30;

UPDATE "CountrySettings"
SET "maxActiveBillingPerInvoicer" = 10
WHERE "maxActiveBillingPerInvoicer" = 5;

UPDATE "CountrySettings"
SET "billingClaimTimeoutMin" = 30
WHERE "billingClaimTimeoutMin" = 15;
