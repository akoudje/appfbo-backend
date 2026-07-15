-- AS400 gateway country-level configuration.
-- No AS400 credentials are stored here; machine secrets remain on the automation host.

CREATE TABLE "As400GatewayConfig" (
  "id" TEXT NOT NULL,
  "countryId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "defaultMode" "As400AutomationMode" NOT NULL DEFAULT 'OBSERVATION',
  "allowObservation" BOOLEAN NOT NULL DEFAULT true,
  "allowAssisted" BOOLEAN NOT NULL DEFAULT false,
  "allowAutomatic" BOOLEAN NOT NULL DEFAULT false,
  "workerId" TEXT,
  "hllapiProfileName" TEXT,
  "sessionName" TEXT,
  "environmentLabel" TEXT,
  "maxAttempts" INTEGER NOT NULL DEFAULT 1,
  "lockTimeoutSeconds" INTEGER NOT NULL DEFAULT 900,
  "pollIntervalSeconds" INTEGER NOT NULL DEFAULT 30,
  "claimBatchSize" INTEGER NOT NULL DEFAULT 1,
  "settingsJson" JSONB,
  "lastHeartbeatAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "As400GatewayConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "As400GatewayConfig_countryId_key" ON "As400GatewayConfig"("countryId");
CREATE INDEX "As400GatewayConfig_countryId_enabled_idx" ON "As400GatewayConfig"("countryId", "enabled");
CREATE INDEX "As400GatewayConfig_lastHeartbeatAt_idx" ON "As400GatewayConfig"("lastHeartbeatAt");

ALTER TABLE "As400GatewayConfig"
  ADD CONSTRAINT "As400GatewayConfig_countryId_fkey"
  FOREIGN KEY ("countryId") REFERENCES "Country"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
