ALTER TABLE "CountrySettings" ADD COLUMN "publicAnnouncementEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CountrySettings" ADD COLUMN "publicAnnouncementMessage" TEXT;
