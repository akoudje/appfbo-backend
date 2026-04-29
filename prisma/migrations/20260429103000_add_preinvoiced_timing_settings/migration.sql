ALTER TABLE "CountrySettings"
ADD COLUMN "preinvoicedAutoCancelAfterHours" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN "preinvoicedAutoReminderAfterHours" INTEGER NOT NULL DEFAULT 1;
