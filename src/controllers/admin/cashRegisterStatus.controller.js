const prisma = require("../../prisma");
const {
  cancelPendingInvoicedPreordersForCountry,
} = require("../../services/cash-register-closure.service");

// Interrupteur temporaire "paiements en ligne ouverts / fermés" par pays.
// Fermer :
//  - annule les liens de paiement hors précommande encore actifs et bloque
//    la création de nouveaux via le kiosque QR ;
//  - annule les précommandes préfacturées (INVOICED / PAYMENT_PENDING) et
//    bloque l'initiation publique de paiement Wave pour ces commandes
//    (voir payments.service.js#initiateWavePayment) ;
// pour éviter qu'un client paie alors que le comptoir physique est fermé et
// que personne ne peut le servir. À retirer une fois l'automatisation
// réelle des horaires de caisse en place.

const DEFAULT_CLOSED_MESSAGE =
  "Le comptoir est actuellement fermé. Merci de réessayer pendant nos heures d'ouverture.";

const includeActors = {
  closedBy: { select: { id: true, fullName: true, email: true, role: true } },
  reopenedBy: { select: { id: true, fullName: true, email: true, role: true } },
};

function serialize(status) {
  if (!status) return { isOpen: true, closedMessage: null };
  return {
    isOpen: status.isOpen,
    closedMessage: status.closedMessage || null,
    closedAt: status.closedAt,
    closedBy: status.closedBy || null,
    reopenedAt: status.reopenedAt,
    reopenedBy: status.reopenedBy || null,
    updatedAt: status.updatedAt,
  };
}

async function getOrCreateStatus(countryId) {
  const existing = await prisma.cashRegisterStatus.findUnique({
    where: { countryId },
    include: includeActors,
  });
  if (existing) return existing;
  return prisma.cashRegisterStatus.create({
    data: { countryId },
    include: includeActors,
  });
}

async function getStatus(req, res) {
  try {
    const status = await getOrCreateStatus(req.countryId);
    return res.json({ ok: true, status: serialize(status) });
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

    const result = await prisma.$transaction(async (tx) => {
      const status = await tx.cashRegisterStatus.upsert({
        where: { countryId: req.countryId },
        update: {
          isOpen: false,
          closedMessage,
          closedAt: new Date(),
          closedById: actorAdminId,
        },
        create: {
          countryId: req.countryId,
          isOpen: false,
          closedMessage,
          closedAt: new Date(),
          closedById: actorAdminId,
        },
        include: includeActors,
      });

      const cancelledLinks = await tx.externalPaymentLink.updateMany({
        where: { countryId: req.countryId, status: "ACTIVE" },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          updatedById: actorAdminId,
        },
      });

      const cancelledPreordersCount = await cancelPendingInvoicedPreordersForCountry({
        tx,
        countryId: req.countryId,
        reason: "Paiement non reçu : précommande annulée à la fermeture de caisse.",
        actorAdminId,
      });

      return { status, cancelledLinksCount: cancelledLinks.count, cancelledPreordersCount };
    });

    return res.json({
      ok: true,
      status: serialize(result.status),
      cancelledLinksCount: result.cancelledLinksCount,
      cancelledPreordersCount: result.cancelledPreordersCount,
    });
  } catch (error) {
    console.error("cashRegisterStatus.closeRegister error:", error);
    return res.status(500).json({ message: "Erreur serveur (fermeture caisse)" });
  }
}

async function openRegister(req, res) {
  try {
    const status = await prisma.cashRegisterStatus.upsert({
      where: { countryId: req.countryId },
      update: {
        isOpen: true,
        reopenedAt: new Date(),
        reopenedById: req.user?.id || null,
      },
      create: {
        countryId: req.countryId,
        isOpen: true,
        reopenedAt: new Date(),
        reopenedById: req.user?.id || null,
      },
      include: includeActors,
    });

    return res.json({ ok: true, status: serialize(status) });
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
