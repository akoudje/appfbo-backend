-- CreateEnum
CREATE TYPE "TicketCheckInResult" AS ENUM ('ACCEPTED', 'ALREADY_USED', 'WRONG_EVENT', 'INACTIVE', 'NOT_FOUND', 'INVALID');

-- CreateTable
CREATE TABLE "TicketCheckInSession" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "agentId" TEXT,
    "entryPoint" TEXT NOT NULL,
    "deviceName" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketCheckInSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketCheckInLog" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "eventId" TEXT,
    "ticketTypeId" TEXT,
    "ticketId" TEXT,
    "orderId" TEXT,
    "sessionId" TEXT,
    "checkedById" TEXT,
    "entryPoint" TEXT,
    "scannedValue" TEXT,
    "ticketCode" TEXT,
    "result" "TicketCheckInResult" NOT NULL,
    "reason" TEXT,
    "ticketStatusBefore" "TicketStatus",
    "ticketStatusAfter" "TicketStatus",
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketCheckInLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketCheckInSession_countryId_eventId_openedAt_idx" ON "TicketCheckInSession"("countryId", "eventId", "openedAt");
CREATE INDEX "TicketCheckInSession_agentId_openedAt_idx" ON "TicketCheckInSession"("agentId", "openedAt");
CREATE INDEX "TicketCheckInSession_closedAt_idx" ON "TicketCheckInSession"("closedAt");

-- CreateIndex
CREATE INDEX "TicketCheckInLog_countryId_eventId_scannedAt_idx" ON "TicketCheckInLog"("countryId", "eventId", "scannedAt");
CREATE INDEX "TicketCheckInLog_ticketId_scannedAt_idx" ON "TicketCheckInLog"("ticketId", "scannedAt");
CREATE INDEX "TicketCheckInLog_sessionId_scannedAt_idx" ON "TicketCheckInLog"("sessionId", "scannedAt");
CREATE INDEX "TicketCheckInLog_checkedById_scannedAt_idx" ON "TicketCheckInLog"("checkedById", "scannedAt");
CREATE INDEX "TicketCheckInLog_result_scannedAt_idx" ON "TicketCheckInLog"("result", "scannedAt");

-- AddForeignKey
ALTER TABLE "TicketCheckInSession" ADD CONSTRAINT "TicketCheckInSession_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketCheckInSession" ADD CONSTRAINT "TicketCheckInSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "TicketEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketCheckInSession" ADD CONSTRAINT "TicketCheckInSession_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketCheckInLog" ADD CONSTRAINT "TicketCheckInLog_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketCheckInLog" ADD CONSTRAINT "TicketCheckInLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "TicketEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TicketCheckInLog" ADD CONSTRAINT "TicketCheckInLog_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TicketCheckInLog" ADD CONSTRAINT "TicketCheckInLog_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TicketCheckInLog" ADD CONSTRAINT "TicketCheckInLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TicketOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TicketCheckInLog" ADD CONSTRAINT "TicketCheckInLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TicketCheckInSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TicketCheckInLog" ADD CONSTRAINT "TicketCheckInLog_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
