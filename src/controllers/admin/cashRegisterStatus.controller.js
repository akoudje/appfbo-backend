const prisma = require("../../prisma");

// Interrupteur temporaire "paiements en ligne ouverts / fermés" par pays.
// Fermer bloque la création de nouveaux liens de paiement hors précommande
// via le kiosque QR et annule ceux encore actifs, pour éviter qu'un client
// paie via Wave alors que le comptoir physique est fermé et que personne ne
// peut le servir. À retirer une fois l'automatisation réelle des horaires
// de caisse en place.

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

    const [status, cancelledLinks] = await prisma.$transaction([
      prisma.cashRegisterStatus.upsert({
        where: { countryId: req.countryId },
        update: {
          isOpen: false,
          closedMessage,
          closedAt: new Date(),
          closedById: req.user?.id || null,
        },
        create: {
          countryId: req.countryId,
          isOpen: false,
          closedMessage,
          closedAt: new Date(),
          closedById: req.user?.id || null,
        },
        include: includeActors,
      }),
      prisma.externalPaymentLink.updateMany({
        where: { countryId: req.countryId, status: "ACTIVE" },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          updatedById: req.user?.id || null,
        },
      }),
    ]);

    return res.json({
      ok: true,
      status: serialize(status),
      cancelledLinksCount: cancelledLinks.count,
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
