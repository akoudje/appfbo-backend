const prisma = require("../prisma");
const { listPendingLaunches } = require("./cashier-launch-alerts.service");

// Annulation en masse des précommandes préfacturées (INVOICED / PAYMENT_PENDING)
// à la fermeture de caisse — voir cashRegisterStatus.controller.js. Ce sont
// des commandes qu'un client peut encore payer à distance via
// POST /api/payments/wave/public/initiate à toute heure, même une fois le
// comptoir physique fermé. Ne concerne que les précommandes : les liens de
// paiement hors app (QR) et les billets d'événement ne sont pas affectés par
// cet interrupteur.
//
// La transaction ci-dessous est un mirroir volontairement minimal de celle
// de cancelOrder (admin/orders.controller.js) : même mise à jour de statut,
// même rollback de stock défensif, même entrée de PreorderLog. Dupliquée
// plutôt que factorisée pour ne pas toucher ce contrôleur volumineux et déjà
// en production, pour une fonctionnalité pensée comme temporaire — à
// unifier si ce mécanisme devient permanent.

const CANCELLABLE_STATUSES = ["INVOICED", "PAYMENT_PENDING"];

const DEFAULT_CLOSED_MESSAGE =
  "Le comptoir est actuellement fermé. Merci de réessayer pendant nos heures d'ouverture.";

// Un facturier caissier (rôle combiné : facture, encaisse et prépare la même
// commande de bout en bout) a sa propre caisse personnelle — la fermer
// n'affecte ni la vue ni le comportement de la caisse d'un collègue. Les
// autres rôles (responsables, CAISSIERE/INVOICER du modèle classique séparé)
// partagent la caisse globale du comptoir (userId null), comme avant —
// même périmètre que la restriction facturation/préparation posée
// précédemment (voir cashier.controller.js#isOwnershipScopedCashier).
function resolveRegisterUserId({ role, userId }) {
  return String(role || "").trim().toUpperCase() === "FACTURIER_CAISSIER" ? userId || null : null;
}

// Find-puis-create plutôt qu'upsert : Postgres autorise plusieurs NULL sur un
// couple UNIQUE, un upsert sur (countryId, userId: null) ne protégerait donc
// pas correctement l'unicité de la ligne globale.
async function getCashRegisterStatus(countryId, userId = null) {
  const status = await prisma.cashRegisterStatus.findFirst({ where: { countryId, userId } });
  return status || { isOpen: true, closedMessage: null };
}

async function getOrCreateCashRegisterStatus(countryId, userId = null) {
  const existing = await prisma.cashRegisterStatus.findFirst({
    where: { countryId, userId },
    include: {
      closedBy: { select: { id: true, fullName: true, email: true, role: true } },
      reopenedBy: { select: { id: true, fullName: true, email: true, role: true } },
    },
  });
  if (existing) return existing;
  return prisma.cashRegisterStatus.create({
    data: { countryId, userId },
    include: {
      closedBy: { select: { id: true, fullName: true, email: true, role: true } },
      reopenedBy: { select: { id: true, fullName: true, email: true, role: true } },
    },
  });
}

// `assignedInvoicerId` : fourni pour une fermeture personnelle (caisse d'un
// facturier caissier), n'annule alors que SES précommandes assignées. Omis
// (undefined/null) pour une fermeture globale du comptoir : comportement
// inchangé, tout le pays.
async function cancelPendingInvoicedPreordersForCountry({
  tx,
  countryId,
  reason,
  actorAdminId = null,
  assignedInvoicerId = null,
  logMeta = {},
}) {
  const orders = await tx.preorder.findMany({
    where: {
      countryId,
      status: { in: CANCELLABLE_STATUSES },
      ...(assignedInvoicerId ? { assignedInvoicerId } : {}),
    },
    include: { items: true },
  });

  for (const order of orders) {
    // Le stock n'est normalement réservé qu'au lancement de la préparation
    // (bien après INVOICED/PAYMENT_PENDING) : ce rollback ne devrait donc
    // jamais s'exécuter ici, gardé uniquement par cohérence défensive avec
    // cancelOrder au cas où l'état changerait.
    const mustRollbackStock = Boolean(order.stockDeductedAt) && !order.stockRestoredAt;
    const now = new Date();

    if (mustRollbackStock) {
      for (const item of order.items) {
        await tx.countryProduct.update({
          where: {
            countryId_productId: {
              countryId: order.countryId,
              productId: item.productId,
            },
          },
          data: { stockQty: { increment: item.qty } },
        });

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            countryId: order.countryId,
            preorderId: order.id,
            type: "CREDIT",
            reason: "CANCEL_ORDER",
            qty: item.qty,
            note: "Retour stock suite annulation commande (fermeture de caisse)",
            meta: { preorderId: order.id, productId: item.productId, qty: item.qty },
            createdById: actorAdminId,
          },
        });
      }
    }

    await tx.preorder.update({
      where: { id: order.id },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelReason: reason,
        cancelledById: actorAdminId,
        stockRestoredAt: mustRollbackStock ? now : order.stockRestoredAt,
      },
    });

    await tx.preorderLog.create({
      data: {
        preorderId: order.id,
        action: "CANCEL",
        note: reason,
        meta: {
          fromStatus: order.status,
          toStatus: "CANCELLED",
          ...logMeta,
          source: "CASH_REGISTER_CLOSURE",
        },
        actorAdminId,
      },
    });
  }

  return orders.length;
}

// Ce que la fermeture va faire, montré à l'agent AVANT de fermer :
//  - les préfactures non payées qui seront annulées. Une commande payée en
//    espèces mais pas encore saisie serait annulée à tort (incident du
//    04/11/2026 : 23 commandes servies puis annulées, espèces arrivées après
//    la fermeture) ; d'où la confirmation exigée par closeRegister ;
//  - les colis payés pas encore lancés en préparation, qui ne sont pas
//    annulés mais restent à traiter (simple rappel).
// Même périmètre que cancelPendingInvoicedPreordersForCountry.
async function getClosurePreview(db, { countryId, assignedInvoicerId = null }) {
  const [toCancel, paidNotLaunched] = await Promise.all([
    db.preorder.findMany({
      where: {
        countryId,
        status: { in: CANCELLABLE_STATUSES },
        ...(assignedInvoicerId ? { assignedInvoicerId } : {}),
      },
      select: {
        id: true,
        status: true,
        preorderNumber: true,
        parcelNumber: true,
        factureReference: true,
        fboNomComplet: true,
        fboNumero: true,
        preorderPaymentMode: true,
        totalFcfa: true,
        as400InvoiceTotalFcfa: true,
        invoicedAt: true,
      },
      orderBy: [{ invoicedAt: "asc" }, { createdAt: "asc" }],
      take: 500,
    }),
    listPendingLaunches(db, countryId, { ownerId: assignedInvoicerId }),
  ]);

  const rows = toCancel.map((order) => ({
    id: order.id,
    status: order.status,
    label: order.parcelNumber || order.preorderNumber || order.factureReference || order.id,
    factureReference: order.factureReference || null,
    fboNomComplet: order.fboNomComplet || null,
    fboNumero: order.fboNumero || null,
    preorderPaymentMode: order.preorderPaymentMode || null,
    amountFcfa: Number(order.as400InvoiceTotalFcfa || order.totalFcfa || 0) || 0,
    invoicedAt: order.invoicedAt,
  }));

  return {
    toCancel: rows,
    toCancelCount: rows.length,
    toCancelCashCount: rows.filter((row) => row.preorderPaymentMode === "ESPECES").length,
    toCancelAmountFcfa: rows.reduce((sum, row) => sum + row.amountFcfa, 0),
    paidNotLaunched,
    paidNotLaunchedCount: paidNotLaunched.length,
  };
}

module.exports = {
  CANCELLABLE_STATUSES,
  getClosurePreview,
  DEFAULT_CLOSED_MESSAGE,
  resolveRegisterUserId,
  getCashRegisterStatus,
  getOrCreateCashRegisterStatus,
  cancelPendingInvoicedPreordersForCountry,
};
