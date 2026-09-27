-- AlterTable
ALTER TABLE "TicketCheckInLog" ADD COLUMN "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TicketCheckInLog_clientRequestId_key" ON "TicketCheckInLog"("clientRequestId");
