const prisma = require("../../prisma");
const {
  resolveRegisterUserId,
  getOrCreateCashRegisterStatus,
  cancelPendingInvoicedPreordersForCountry,
  getClosurePreview,
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

// Aperçu montré avant la fermeture : préfactures qui seront annulées, colis
// payés pas encore lancés (voir getClosurePreview).
async function getPreview(req, res) {
  try {
    const userId = resolveRegisterUserId({ role: req.user?.role, userId: req.user?.id });
    const preview = await getClosurePreview(prisma, {
      countryId: req.countryId,
      assignedInvoicerId: userId,
    });
    return res.json({ ok: true, scope: userId ? "personal" : "global", preview });
  } catch (error) {
    console.error("cashRegisterStatus.getPreview error:", error);
    return res.status(500).json({ message: "Erreur serveur (aperçu fermeture caisse)" });
  }
}

async function closeRegister(req, res) {
  try {
    const closedMessage =
      String(req.body?.message || "").trim() || DEFAULT_CLOSED_MESSAGE;
    const actorAdminId = req.user?.id || null;
    const userId = resolveRegisterUserId({ role: req.user?.role, userId: actorAdminId });
    const confirmedNoUnrecordedCash = req.body?.confirmNoUnrecordedCash === true;

    // Fermer annule les préfactures non payées. Si l'une d'elles a en fait
    // été payée en espèces sans être saisie, elle serait annulée à tort : on
    // exige donc que l'agent ait vu la liste et confirmé n'avoir aucun
    // encaissement en attente de saisie. Sans préfacture à annuler, rien à
    // confirmer.
    if (!confirmedNoUnrecordedCash) {
      const preview = await getClosurePreview(prisma, {
        countryId: req.countryId,
        assignedInvoicerId: userId,
      });
      if (preview.toCancelCount > 0) {
        return res.status(409).json({
          code: "CLOSURE_CONFIRMATION_REQUIRED",
          message:
            "Vérifiez les préfactures qui seront annulées et confirmez qu'aucun encaissement n'est en attente de saisie avant de fermer la caisse.",
          preview,
        });
      }
    }

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
        logMeta: confirmedNoUnrecordedCash ? { confirmedNoUnrecordedCash: true } : {},
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
  getPreview,
  closeRegister,
  openRegister,
};
