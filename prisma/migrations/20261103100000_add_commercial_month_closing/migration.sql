-- Clôture du mois commercial par pays : les achats facturés avant closesAt
-- comptent pour le mois `month` ("YYYY-MM") ; submitBy = envoi conseillé.
CREATE TABLE "CommercialMonthClosing" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "submitBy" TIMESTAMP(3),
    "updatedByLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialMonthClosing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommercialMonthClosing_countryId_month_key" ON "CommercialMonthClosing"("countryId", "month");

-- AddForeignKey
ALTER TABLE "CommercialMonthClosing" ADD CONSTRAINT "CommercialMonthClosing_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;
