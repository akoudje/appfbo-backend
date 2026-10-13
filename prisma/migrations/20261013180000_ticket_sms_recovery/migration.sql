ALTER TABLE "TicketOrder"
  ADD COLUMN "buyerPhoneVerified" TEXT,
  ADD COLUMN "buyerPhoneVerifiedAt" TIMESTAMP(3);

ALTER TABLE "TicketPortalOtpChallenge"
  ALTER COLUMN "email" DROP NOT NULL,
  ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'LOGIN',
  ADD COLUMN "orderId" TEXT;

CREATE INDEX "TicketOrder_countryId_buyerPhone_idx" ON "TicketOrder"("countryId", "buyerPhone");
CREATE INDEX "TicketPortalOtpChallenge_countryId_phone_purpose_createdAt_idx"
  ON "TicketPortalOtpChallenge"("countryId", "phone", "purpose", "createdAt");
