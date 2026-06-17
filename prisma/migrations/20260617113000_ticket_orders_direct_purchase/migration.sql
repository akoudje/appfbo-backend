ALTER TABLE "TicketOrder"
ADD COLUMN IF NOT EXISTS "ticketTypeId" TEXT,
ADD COLUMN IF NOT EXISTS "quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "holderFullName" TEXT,
ADD COLUMN IF NOT EXISTS "holderPhone" TEXT,
ADD COLUMN IF NOT EXISTS "holderEmail" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'TicketOrder_ticketTypeId_fkey'
  ) THEN
    ALTER TABLE "TicketOrder"
    ADD CONSTRAINT "TicketOrder_ticketTypeId_fkey"
    FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TicketOrder_ticketTypeId_idx" ON "TicketOrder"("ticketTypeId");
