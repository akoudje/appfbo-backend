-- Seuil d'éligibilité (par commande) et réservation manuelle de places pour
-- l'échange des crédits.
ALTER TABLE "TicketEvent" ADD COLUMN "creditEligibilityMinQuantity" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "TicketType" ADD COLUMN "creditReservedCapacity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TicketCredit" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "originEventId" TEXT NOT NULL,
    "originOrderId" TEXT NOT NULL,
    "originTicketId" TEXT NOT NULL,
    "originTicketTypeId" TEXT,
    "ticketTypeLabel" TEXT NOT NULL,
    "priceFcfaSnapshot" INTEGER NOT NULL,
    "holderFullName" TEXT NOT NULL,
    "holderPhone" TEXT,
    "holderEmail" TEXT,
    "status" "TicketCreditStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "redeemedEventId" TEXT,
    "redeemedOrderId" TEXT,
    "redeemedTicketId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketCredit_originTicketId_key" ON "TicketCredit"("originTicketId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketCredit_redeemedTicketId_key" ON "TicketCredit"("redeemedTicketId");

-- CreateIndex
CREATE INDEX "TicketCredit_countryId_status_expiresAt_idx" ON "TicketCredit"("countryId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "TicketCredit_holderPhone_idx" ON "TicketCredit"("holderPhone");

-- CreateIndex
CREATE INDEX "TicketCredit_holderEmail_idx" ON "TicketCredit"("holderEmail");

-- CreateIndex
CREATE INDEX "TicketCredit_originEventId_idx" ON "TicketCredit"("originEventId");

-- CreateIndex
CREATE INDEX "TicketCredit_redeemedEventId_idx" ON "TicketCredit"("redeemedEventId");

-- AddForeignKey
ALTER TABLE "TicketCredit" ADD CONSTRAINT "TicketCredit_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketCredit" ADD CONSTRAINT "TicketCredit_originEventId_fkey" FOREIGN KEY ("originEventId") REFERENCES "TicketEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketCredit" ADD CONSTRAINT "TicketCredit_originOrderId_fkey" FOREIGN KEY ("originOrderId") REFERENCES "TicketOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketCredit" ADD CONSTRAINT "TicketCredit_originTicketId_fkey" FOREIGN KEY ("originTicketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketCredit" ADD CONSTRAINT "TicketCredit_redeemedEventId_fkey" FOREIGN KEY ("redeemedEventId") REFERENCES "TicketEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketCredit" ADD CONSTRAINT "TicketCredit_redeemedOrderId_fkey" FOREIGN KEY ("redeemedOrderId") REFERENCES "TicketOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketCredit" ADD CONSTRAINT "TicketCredit_redeemedTicketId_fkey" FOREIGN KEY ("redeemedTicketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketCredit" ADD CONSTRAINT "TicketCredit_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
