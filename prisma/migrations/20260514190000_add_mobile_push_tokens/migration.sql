-- Store Expo push tokens associated with FBO customer devices.
CREATE TABLE "MobilePushToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "fboId" TEXT,
    "countryId" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobilePushToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobilePushToken_token_key" ON "MobilePushToken"("token");
CREATE INDEX "MobilePushToken_fboId_enabled_idx" ON "MobilePushToken"("fboId", "enabled");
CREATE INDEX "MobilePushToken_countryId_enabled_idx" ON "MobilePushToken"("countryId", "enabled");
CREATE INDEX "MobilePushToken_platform_idx" ON "MobilePushToken"("platform");
CREATE INDEX "MobilePushToken_lastSeenAt_idx" ON "MobilePushToken"("lastSeenAt");

ALTER TABLE "MobilePushToken"
  ADD CONSTRAINT "MobilePushToken_fboId_fkey"
  FOREIGN KEY ("fboId") REFERENCES "Fbo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MobilePushToken"
  ADD CONSTRAINT "MobilePushToken_countryId_fkey"
  FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;
