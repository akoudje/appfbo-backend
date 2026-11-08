-- Rappels « colis payés à lancer » de l'espace agent de vente (réglages par pays).
ALTER TABLE "CountrySettings" ADD COLUMN "cashierLaunchWarnAfterMinutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "CountrySettings" ADD COLUMN "cashierLaunchAlertAfterMinutes" INTEGER NOT NULL DEFAULT 25;
ALTER TABLE "CountrySettings" ADD COLUMN "cashierLaunchReminderIntervalMinutes" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "CountrySettings" ADD COLUMN "cashierLaunchMaxReminders" INTEGER NOT NULL DEFAULT 3;
