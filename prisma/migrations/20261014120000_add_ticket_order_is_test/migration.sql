ALTER TABLE "TicketOrder" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "TicketOrder_eventId_isTest_idx" ON "TicketOrder"("eventId", "isTest");
