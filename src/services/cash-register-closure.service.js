const prisma = require("../prisma");

// Annulation en masse des précommandes préfacturées (INVOICED / PAYMENT_PENDING)
// à la fermeture de caisse — voir cashRegisterStatus.controller.js. Ce sont
// des commandes qu'un client peut encore payer à distance via
// POST /api/payments/wave/public/initiate à toute heure, même une fois le
// comptoir physique fermé.
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

async function getCashRegisterStatus(countryId) {
  const status = await prisma.cashRegisterStatus.findUnique({ where: { countryId } });
  return status || { isOpen: true, closedMessage: null };
}

async function cancelPendingInvoicedPreordersForCountry({
  tx,
  countryId,
  reason,
  actorAdminId = null,
}) {
  const orders = await tx.preorder.findMany({
    where: { countryId, status: { in: CANCELLABLE_STATUSES } },
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
          source: "CASH_REGISTER_CLOSURE",
        },
        actorAdminId,
      },
    });
  }

  return orders.length;
}

module.exports = {
  CANCELLABLE_STATUSES,
  DEFAULT_CLOSED_MESSAGE,
  getCashRegisterStatus,
  cancelPendingInvoicedPreordersForCountry,
};
