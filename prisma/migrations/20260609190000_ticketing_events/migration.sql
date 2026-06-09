-- CreateEnum
CREATE TYPE "TicketEventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TicketOrderStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'PAID', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('RESERVED', 'ACTIVE', 'USED', 'CANCELLED');

-- CreateTable
CREATE TABLE "TicketEvent" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "venueName" TEXT,
    "venueAddress" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "posterUrl" TEXT,
    "status" "TicketEventStatus" NOT NULL DEFAULT 'DRAFT',
    "capacity" INTEGER,
    "salesOpenAt" TIMESTAMP(3),
    "salesCloseAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketType" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "priceFcfa" INTEGER NOT NULL,
    "capacity" INTEGER,
    "maxPerOrder" INTEGER NOT NULL DEFAULT 10,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketOrder" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" "TicketOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "buyerFullName" TEXT NOT NULL,
    "buyerPhone" TEXT NOT NULL,
    "buyerEmail" TEXT,
    "buyerFboNumber" TEXT,
    "buyerFboName" TEXT,
    "totalFcfa" INTEGER NOT NULL DEFAULT 0,
    "paymentMethod" TEXT,
    "paymentProvider" TEXT,
    "paymentReference" TEXT,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "ticketCode" TEXT NOT NULL,
    "qrToken" TEXT NOT NULL,
    "holderFullName" TEXT NOT NULL,
    "holderPhone" TEXT,
    "holderEmail" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'RESERVED',
    "checkedInAt" TIMESTAMP(3),
    "checkedInById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketEvent_countryId_slug_key" ON "TicketEvent"("countryId", "slug");
CREATE INDEX "TicketEvent_countryId_status_startsAt_idx" ON "TicketEvent"("countryId", "status", "startsAt");
CREATE INDEX "TicketEvent_startsAt_idx" ON "TicketEvent"("startsAt");

-- CreateIndex
CREATE INDEX "TicketType_eventId_active_sortOrder_idx" ON "TicketType"("eventId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TicketOrder_orderNumber_key" ON "TicketOrder"("orderNumber");
CREATE INDEX "TicketOrder_countryId_status_createdAt_idx" ON "TicketOrder"("countryId", "status", "createdAt");
CREATE INDEX "TicketOrder_eventId_status_createdAt_idx" ON "TicketOrder"("eventId", "status", "createdAt");
CREATE INDEX "TicketOrder_buyerPhone_idx" ON "TicketOrder"("buyerPhone");
CREATE INDEX "TicketOrder_buyerFboNumber_idx" ON "TicketOrder"("buyerFboNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_ticketCode_key" ON "Ticket"("ticketCode");
CREATE UNIQUE INDEX "Ticket_qrToken_key" ON "Ticket"("qrToken");
CREATE INDEX "Ticket_countryId_status_idx" ON "Ticket"("countryId", "status");
CREATE INDEX "Ticket_eventId_status_idx" ON "Ticket"("eventId", "status");
CREATE INDEX "Ticket_orderId_idx" ON "Ticket"("orderId");
CREATE INDEX "Ticket_ticketTypeId_idx" ON "Ticket"("ticketTypeId");

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TicketType" ADD CONSTRAINT "TicketType_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "TicketEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketOrder" ADD CONSTRAINT "TicketOrder_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketOrder" ADD CONSTRAINT "TicketOrder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "TicketEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "TicketEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TicketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
