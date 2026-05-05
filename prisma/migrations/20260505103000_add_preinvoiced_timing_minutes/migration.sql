ALTER TABLE "CountrySettings"
ADD COLUMN "preinvoicedAutoCancelAfterMinutes" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN "preinvoicedAutoReminderAfterMinutes" INTEGER NOT NULL DEFAULT 60;

UPDATE "CountrySettings"
SET
  "preinvoicedAutoCancelAfterMinutes" = GREATEST(1, "preinvoicedAutoCancelAfterHours" * 60),
  "preinvoicedAutoReminderAfterMinutes" = GREATEST(1, "preinvoicedAutoReminderAfterHours" * 60);
