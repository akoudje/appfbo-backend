const prisma = require("../../prisma");
const {
  resolveRegisterUserId,
  getOrCreateCashRegisterStatus,
  cancelPendingInvoicedPreordersForCountry,
} = require("../../services/cash-register-closure.service");

// Interrupteur temporaire "précommandes payables en ligne / non" par pays —
// personnel pour un facturier caissier (rôle combiné), partagé pour les
// autres rôles (responsables, modèle classique séparé CAISSIERE/INVOICER).
// Fermer sa caisse :
//  - annule les précommandes préfacturées (INVOICED / PAYMENT_PENDING) qui
//    lui sont assignées (ou tout le pays pour une fermeture globale) ;
//  - bloque l'initiation publique de paiement Wave pour ces commandes (voir
//    payments.service.js#initiateWavePayment) ;
// pour éviter qu'un client paie alors que personne ne peut le servir. Les
// liens de paiement hors app (QR) et les billets d'événement ne sont pas
// concernés. À retirer une fois l'automatisation réelle des horaires de
// caisse en place.

const DEFAULT_CLOSED_MESSAGE =
  "Le comptoir est actuellement fermé. Merci de réessayer pendant nos heures d'ouverture.";

function serialize(status, userId) {
  if (!status) return { isOpen: true, closedMessage: null, scope: userId ? "personal" : "global" };
  return {
    isOpen: status.isOpen,
    closedMessage: status.closedMessage || null,
    closedAt: status.closedAt,
    closedBy: status.closedBy || null,
    reopenedAt: status.reopenedAt,
    reopenedBy: status.reopenedBy || null,
    updatedAt: status.updatedAt,
    scope: userId ? "personal" : "global",
  };
}

async function getStatus(req, res) {
  try {
    const userId = resolveRegisterUserId({ role: req.user?.role, userId: req.user?.id });
    const status = await getOrCreateCashRegisterStatus(req.countryId, userId);
    return res.json({ ok: true, status: serialize(status, userId) });
  } catch (error) {
    console.error("cashRegisterStatus.getStatus error:", error);
    return res.status(500).json({ message: "Erreur serveur (statut caisse)" });
  }
}

async function closeRegister(req, res) {
  try {
    const closedMessage =
      String(req.body?.message || "").trim() || DEFAULT_CLOSED_MESSAGE;
    const actorAdminId = req.user?.id || null;
    const userId = resolveRegisterUserId({ role: req.user?.role, userId: actorAdminId });

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.cashRegisterStatus.findFirst({
        where: { countryId: req.countryId, userId },
      });
      const status = existing
        ? await tx.cashRegisterStatus.update({
            where: { id: existing.id },
            data: { isOpen: false, closedMessage, closedAt: new Date(), closedById: actorAdminId },
            include: {
              closedBy: { select: { id: true, fullName: true, email: true, role: true } },
              reopenedBy: { select: { id: true, fullName: true, email: true, role: true } },
            },
          })
        : await tx.cashRegisterStatus.create({
            data: {
              countryId: req.countryId,
              userId,
              isOpen: false,
              closedMessage,
              closedAt: new Date(),
              closedById: actorAdminId,
            },
            include: {
              closedBy: { select: { id: true, fullName: true, email: true, role: true } },
              reopenedBy: { select: { id: true, fullName: true, email: true, role: true } },
            },
          });

      const cancelledPreordersCount = await cancelPendingInvoicedPreordersForCountry({
        tx,
        countryId: req.countryId,
        reason: userId
          ? "Paiement non reçu : précommande annulée à la fermeture de la caisse du facturier."
          : "Paiement non reçu : précommande annulée à la fermeture de caisse.",
        actorAdminId,
        assignedInvoicerId: userId,
      });

      return { status, cancelledPreordersCount };
    });

    return res.json({
      ok: true,
      status: serialize(result.status, userId),
      cancelledPreordersCount: result.cancelledPreordersCount,
    });
  } catch (error) {
    console.error("cashRegisterStatus.closeRegister error:", error);
    return res.status(500).json({ message: "Erreur serveur (fermeture caisse)" });
  }
}

async function openRegister(req, res) {
  try {
    const actorAdminId = req.user?.id || null;
    const userId = resolveRegisterUserId({ role: req.user?.role, userId: actorAdminId });

    const existing = await prisma.cashRegisterStatus.findFirst({
      where: { countryId: req.countryId, userId },
    });
    const includeActors = {
      closedBy: { select: { id: true, fullName: true, email: true, role: true } },
      reopenedBy: { select: { id: true, fullName: true, email: true, role: true } },
    };
    const status = existing
      ? await prisma.cashRegisterStatus.update({
          where: { id: existing.id },
          data: { isOpen: true, reopenedAt: new Date(), reopenedById: actorAdminId },
          include: includeActors,
        })
      : await prisma.cashRegisterStatus.create({
          data: { countryId: req.countryId, userId, isOpen: true, reopenedAt: new Date(), reopenedById: actorAdminId },
          include: includeActors,
        });

    return res.json({ ok: true, status: serialize(status, userId) });
  } catch (error) {
    console.error("cashRegisterStatus.openRegister error:", error);
    return res.status(500).json({ message: "Erreur serveur (réouverture caisse)" });
  }
}

module.exports = {
  getStatus,
  closeRegister,
  openRegister,
};
