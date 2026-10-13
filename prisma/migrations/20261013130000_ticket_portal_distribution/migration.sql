ALTER TABLE "Ticket" ADD COLUMN "assignedGuestName" TEXT, ADD COLUMN "guestAssignedAt" TIMESTAMP(3);
CREATE TABLE "TicketShareEvent" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "guestName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketShareEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TicketShareEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TicketShareEvent_ticketId_requestId_key" ON "TicketShareEvent"("ticketId", "requestId");
CREATE INDEX "TicketShareEvent_ticketId_createdAt_idx" ON "TicketShareEvent"("ticketId", "createdAt");
CREATE TABLE "TicketPortalOtpChallenge" (
  "id" TEXT NOT NULL,
  "countryId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketPortalOtpChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TicketPortalOtpChallenge_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TicketPortalOtpChallenge_countryId_email_createdAt_idx" ON "TicketPortalOtpChallenge"("countryId", "email", "createdAt");
CREATE INDEX "TicketPortalOtpChallenge_expiresAt_idx" ON "TicketPortalOtpChallenge"("expiresAt");
CREATE INDEX "TicketOrder_countryId_buyerEmail_createdAt_idx" ON "TicketOrder"("countryId", "buyerEmail", "createdAt");
