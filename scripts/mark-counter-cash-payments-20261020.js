/**
 * Marque comme payées (espèces au comptoir) 13 précommandes signalées
 * explicitement par l'équipe comme réglées à la caisse, malgré un mode de
 * paiement enregistré "WAVE" et une annulation automatique (2h sans
 * paiement confirmé par le circuit Wave suivi) pour 9 d'entre elles.
 *
 * Réutilise la vraie fonction d'encaissement espèces (payments.controller.js
 * #markCashPayment) pour une fidélité totale (CashierTransaction, logs,
 * notification SMS de confirmation réelle au client). Pour les commandes
 * déjà annulées, réactive d'abord (statut -> INVOICED) puisque cette
 * fonction refuse normalement la transition CANCELLED -> PAID.
 *
 * Montant reçu : total de la commande (paiement exact supposé, aucun
 * montant précis communiqué). Référence de reçu : COMPTOIR-<n° commande>
 * (pas de numéro de reçu physique communiqué).
 *
 * Usage: node backend/scripts/mark-counter-cash-payments-20261020.js
 */

const prisma = require("../src/prisma");
const { markCashPayment } = require("../src/controllers/admin/payments.controller");

const ORDER_NUMBERS = [
  "PO-CIV-20261020-0235",
  "PO-CIV-20261020-0233",
  "PO-CIV-20261020-0232",
  "PO-CIV-20261020-0231",
  "PO-CIV-20261020-0230",
  "PO-CIV-20261020-0229",
  "PO-CIV-20261020-0227",
  "PO-CIV-20261020-0226",
  "PO-CIV-20261020-0224",
  "PO-CIV-20261020-0222",
  "PO-CIV-20261020-0221",
  "PO-CIV-20261020-0219",
  "PO-CIV-20261020-0218",
];

function fakeRes(preorderNumber) {
  return {
    json(body) {
      console.log(`[OK] ${preorderNumber} -> ${body.status}`);
    },
    status(code) {
      return {
        json(body) {
          console.error(`[ERREUR ${code}] ${preorderNumber}:`, body.message || body);
        },
      };
    },
  };
}

async function main() {
  const orders = await prisma.preorder.findMany({
    where: { preorderNumber: { in: ORDER_NUMBERS } },
    select: {
      id: true,
      preorderNumber: true,
      status: true,
      countryId: true,
      totalFcfa: true,
      assignedInvoicerId: true,
    },
  });

  const byNumber = new Map(orders.map((o) => [o.preorderNumber, o]));
  const missing = ORDER_NUMBERS.filter((n) => !byNumber.has(n));
  if (missing.length) {
    console.error("Commandes introuvables, arrêt :", missing.join(", "));
    process.exitCode = 1;
    return;
  }

  const adminIds = [...new Set(orders.map((o) => o.assignedInvoicerId).filter(Boolean))];
  const admins = await prisma.adminUser.findMany({
    where: { id: { in: adminIds } },
    select: { id: true, fullName: true, email: true, role: true },
  });
  const adminById = new Map(admins.map((a) => [a.id, a]));

  for (const orderNumber of ORDER_NUMBERS) {
    const order = byNumber.get(orderNumber);
    const admin = adminById.get(order.assignedInvoicerId) || { id: null, fullName: "admin", email: null };

    if (order.status === "CANCELLED") {
      await prisma.preorder.update({
        where: { id: order.id },
        data: {
          status: "INVOICED",
          cancelledAt: null,
          cancelReason: null,
          billingWorkStatus: "WAITING_PAYMENT",
        },
      });
      await prisma.preorderLog.create({
        data: {
          preorderId: order.id,
          action: "PAYMENT_CONFIRMED",
          note: "Réactivation manuelle exceptionnelle : commande annulée automatiquement (2h sans paiement Wave suivi) alors que le client avait réglé au comptoir. Reprise pour encaissement.",
          actorAdminId: admin.id,
          meta: { previousStatus: "CANCELLED", nextStatus: "INVOICED", reason: "COUNTER_PAYMENT_AFTER_AUTO_CANCEL" },
        },
      });
    }

    const req = {
      params: { id: order.id },
      body: {
        note: "Paiement comptoir confirmé par l'équipe (lot du 2026-10-20).",
        receiptNumber: `COMPTOIR-${orderNumber}`,
        amountReceivedFcfa: order.totalFcfa,
        cashDeskLabel: "Comptoir",
      },
      countryId: order.countryId,
      user: { id: admin.id, fullName: admin.fullName, email: admin.email },
    };

    await markCashPayment(req, fakeRes(orderNumber));
  }
}

main()
  .catch((error) => {
    console.error("[ERREUR]", error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
