// Crédits émis pour les billets payés jamais scannés à la clôture d'un
// événement (voir services/ticket-event-closure.service.js et
// services/ticket-credit.service.js pour la logique métier).

const prisma = require("../../../prisma");
const { closeTicketEventAndIssueCredits } = require("../../../services/ticket-event-closure.service");

async function closeEvent(req, res) {
  try {
    const event = await prisma.ticketEvent.findFirst({
      where: { id: req.params.id, countryId: req.countryId },
      select: { id: true },
    });
    if (!event) return res.status(404).json({ message: "Événement introuvable" });

    const result = await closeTicketEventAndIssueCredits({ eventId: event.id, actorAdminId: req.user?.id || null });
    if (result.skipped && result.reason === "ALREADY_CLOSED") {
      return res.status(409).json({ message: `L'événement est déjà en statut ${result.status}.` });
    }
    return res.json({ ok: true, creditsCount: result.creditsCount || 0 });
  } catch (error) {
    console.error("ticketEvents.closeEvent error:", error);
    return res.status(500).json({ message: "Erreur serveur (closeEvent)" });
  }
}

async function listEventCredits(req, res) {
  try {
    const event = await prisma.ticketEvent.findFirst({
      where: { id: req.params.id, countryId: req.countryId },
      select: { id: true },
    });
    if (!event) return res.status(404).json({ message: "Événement introuvable" });

    const credits = await prisma.ticketCredit.findMany({
      where: { originEventId: event.id },
      orderBy: [{ issuedAt: "desc" }],
      include: { redeemedEvent: { select: { id: true, title: true } } },
    });
    return res.json({ data: credits });
  } catch (error) {
    console.error("ticketEvents.listEventCredits error:", error);
    return res.status(500).json({ message: "Erreur serveur (listEventCredits)" });
  }
}

// Crédits actifs (émis, non expirés) groupés par catégorie, pour ce pays —
// ce que l'admin consulte pour décider combien de places réserver
// (TicketType.creditReservedCapacity) sur la prochaine édition.
async function getActiveCreditCounts(req, res) {
  try {
    const now = new Date();
    const credits = await prisma.ticketCredit.groupBy({
      by: ["ticketTypeLabel"],
      where: { countryId: req.countryId, status: "ISSUED", expiresAt: { gt: now } },
      _count: { _all: true },
    });
    return res.json({
      data: credits.map((row) => ({ ticketTypeLabel: row.ticketTypeLabel, activeCreditsCount: row._count._all })),
    });
  } catch (error) {
    console.error("ticketEvents.getActiveCreditCounts error:", error);
    return res.status(500).json({ message: "Erreur serveur (getActiveCreditCounts)" });
  }
}

async function revokeCredit(req, res) {
  try {
    const { reason } = req.body || {};
    const credit = await prisma.ticketCredit.findFirst({
      where: { id: req.params.creditId, countryId: req.countryId },
    });
    if (!credit) return res.status(404).json({ message: "Crédit introuvable" });
    if (credit.status !== "ISSUED") {
      return res.status(409).json({ message: `Ce crédit est déjà en statut ${credit.status}.` });
    }

    const updated = await prisma.ticketCredit.update({
      where: { id: credit.id },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedById: req.user?.id || null,
        revokeReason: reason ? String(reason).trim() : null,
      },
    });
    return res.json(updated);
  } catch (error) {
    console.error("ticketEvents.revokeCredit error:", error);
    return res.status(500).json({ message: "Erreur serveur (revokeCredit)" });
  }
}

module.exports = {
  closeEvent,
  listEventCredits,
  getActiveCreditCounts,
  revokeCredit,
};
