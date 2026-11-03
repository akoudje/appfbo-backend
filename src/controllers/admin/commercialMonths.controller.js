// Clôtures du mois commercial d'un pays (Réglages → mois commercial).
const prisma = require("../../prisma");
const { pickCountryId } = require("../../helpers/countryScope");
const { clearStorefrontConfigCache } = require("../publicConfig.controller");
const {
  addMonths,
  describeCommercialMonth,
  isMonthKey,
  serializeClosing,
  validateClosing,
} = require("../../services/commercial-month.service");

const RECENT_MONTHS = 12;

async function listCommercialMonths(req, res) {
  try {
    const countryId = pickCountryId(req);
    const rows = await prisma.commercialMonthClosing.findMany({
      where: { countryId },
      orderBy: { month: "desc" },
      take: RECENT_MONTHS,
    });
    return res.json({
      data: rows.map((row) => serializeClosing(row, req.country?.code)),
      current: describeCommercialMonth(rows, req.country?.code),
    });
  } catch (error) {
    console.error("listCommercialMonths error:", error);
    return res.status(500).json({ message: "Impossible de charger les clôtures du mois commercial." });
  }
}

async function upsertCommercialMonth(req, res) {
  try {
    const countryId = pickCountryId(req);
    const month = req.params.month;
    if (!isMonthKey(month)) return res.status(400).json({ message: "Mois invalide." });
    const neighbours = await prisma.commercialMonthClosing.findMany({
      where: { countryId, month: { in: [addMonths(month, -1), addMonths(month, 1)] } },
      select: { month: true, closesAt: true },
    });
    const byMonth = Object.fromEntries(neighbours.map((row) => [row.month, row.closesAt]));
    const checked = validateClosing(
      { month, closesAtLocal: req.body?.closesAtLocal, submitByLocal: req.body?.submitByLocal },
      req.country?.code,
      { previous: byMonth[addMonths(month, -1)], next: byMonth[addMonths(month, 1)] },
    );
    if (checked.errors)
      return res.status(400).json({ message: "Corrigez les champs indiqués.", errors: checked.errors });
    const values = {
      closesAt: checked.data.closesAt,
      submitBy: checked.data.submitBy,
      updatedByLabel: req.user?.email || "Administrateur",
    };
    const row = await prisma.commercialMonthClosing.upsert({
      where: { countryId_month: { countryId, month } },
      update: values,
      create: { countryId, month, ...values },
    });
    clearStorefrontConfigCache(countryId);
    return res.json({ data: serializeClosing(row, req.country?.code) });
  } catch (error) {
    console.error("upsertCommercialMonth error:", error);
    return res.status(500).json({ message: "Impossible d’enregistrer cette clôture." });
  }
}

async function deleteCommercialMonth(req, res) {
  try {
    const countryId = pickCountryId(req);
    const month = req.params.month;
    if (!isMonthKey(month)) return res.status(400).json({ message: "Mois invalide." });
    await prisma.commercialMonthClosing.deleteMany({ where: { countryId, month } });
    clearStorefrontConfigCache(countryId);
    return res.json({ ok: true });
  } catch (error) {
    console.error("deleteCommercialMonth error:", error);
    return res.status(500).json({ message: "Impossible de supprimer cette clôture." });
  }
}

module.exports = { listCommercialMonths, upsertCommercialMonth, deleteCommercialMonth };
