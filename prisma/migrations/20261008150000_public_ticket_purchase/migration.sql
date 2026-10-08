ALTER TABLE "TicketOrder"
 ADD COLUMN "paymentServiceFeeFcfa" INTEGER,
 ADD COLUMN "amountToPayFcfa" INTEGER,
 ADD COLUMN "clientRequestId" TEXT,
 ADD COLUMN "ticketIssueCode" TEXT;
CREATE UNIQUE INDEX "TicketOrder_countryId_clientRequestId_key" ON "TicketOrder"("countryId", "clientRequestId");
