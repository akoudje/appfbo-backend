/**
 * Rattachement exceptionnel de 2 paiements QR (Wave) aux commandes
 * correspondantes, malgré un écart de ~100 F par paire (qui se compense
 * entre les deux paires) — demandé explicitement le 2026-10-19.
 *
 * Le rattachement normal (admin-app > Liens de paiement > "Rattacher à une
 * commande", POST /admin/external-payment-links/:id/attach-order) refuse
 * tout écart de montant ; ce script reproduit exactement sa logique
 * (création Payment + PaymentAttempt, passage de la commande à PAID,
 * journal PreorderLog, mise à jour du lien externe) sans cette vérification,
 * pour ces deux paires précises uniquement. Ne modifie aucun code
 * d'application : n'affecte pas le comportement du bouton pour tout autre
 * rattachement.
 *
 * Usage: node backend/scripts/reconcile-qr-payments-20261019.js
 */

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const PAIRS = [
  { linkReference: "QR-20261019-0024", preorderNumber: "PO-CIV-20261019-0352" },
  { linkReference: "QR-20261019-0041", preorderNumber: "PO-CIV-20261019-0355" },
];

async function reconcilePair({ linkReference, preorderNumber }) {
  const link = await prisma.externalPaymentLink.findFirst({ where: { reference: linkReference } });
  if (!link) throw new Error(`Lien externe introuvable : ${linkReference}`);
  if (link.status !== "PAID") throw new Error(`Lien ${linkReference} non payé (statut ${link.status}).`);

  const order = await prisma.preorder.findFirst({ where: { preorderNumber } });
  if (!order) throw new Error(`Commande introuvable : ${preorderNumber}`);
  if (order.paymentStatus === "PAID" || ["PAID", "READY", "FULFILLED", "CANCELLED"].includes(order.status)) {
    throw new Error(`Commande ${preorderNumber} déjà soldée ou annulée (statut ${order.status}/${order.paymentStatus}).`);
  }

  const existingPayment = await prisma.payment.findFirst({
    where: {
      provider: "WAVE",
      OR: [
        ...(link.providerTransactionId ? [{ providerTxnId: link.providerTransactionId }] : []),
        { clientReference: `external:${link.id}` },
      ],
    },
    select: { id: true, preorderId: true },
  });
  if (existingPayment && existingPayment.preorderId !== order.id) {
    throw new Error(`Transaction Wave de ${linkReference} déjà rattachée à une autre commande.`);
  }

  const paidAt = link.paidAt || new Date();
  const amountPaidFcfa = Number(link.amountFcfa || 0);
  const invoiceAmountFcfa = Number(link.baseAmountFcfa || (amountPaidFcfa - Number(link.serviceFeeFcfa || 0)));
  const gapFcfa = invoiceAmountFcfa - Number(order.totalFcfa);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    let paymentId = existingPayment?.id || null;
    let attemptId = null;

    if (!paymentId) {
      const payment = await tx.payment.create({
        data: {
          preorderId: order.id,
          countryId: order.countryId,
          provider: "WAVE",
          methodType: "MOBILE_MONEY",
          status: "SUCCEEDED",
          amountExpectedFcfa: amountPaidFcfa,
          amountPaidFcfa,
          currencyCode: link.currencyCode || "XOF",
          providerReference: link.providerSessionId || link.reference,
          providerTxnId: link.providerTransactionId || null,
          clientReference: `external:${link.id}`,
          initiatedAt: link.createdAt || now,
          paidAt,
        },
      });
      paymentId = payment.id;

      const attempt = await tx.paymentAttempt.create({
        data: {
          paymentId,
          provider: "WAVE",
          status: "SUCCEEDED",
          providerSessionId: link.providerSessionId || null,
          providerTransactionId: link.providerTransactionId || null,
          providerPayerPhone: link.providerPayerPhone || link.customerPhone || null,
          providerStatusLabel: link.providerStatusLabel || null,
          checkoutUrl: link.providerCheckoutUrl || null,
          providerLaunchUrl: link.providerLaunchUrl || null,
          requestPayloadJson: {
            source: "EXTERNAL_PAYMENT_LINK_ATTACH_MANUAL_EXCEPTION",
            externalPaymentLinkId: link.id,
            externalPaymentReference: link.reference,
            externalInvoiceReference: link.invoiceReference,
            amountGapFcfa: gapFcfa,
          },
          responsePayloadJson: link.providerPayloadJson || null,
          normalizedPayloadJson: {
            externalPaymentLinkId: link.id,
            reference: link.reference,
            providerSessionId: link.providerSessionId || null,
            providerTransactionId: link.providerTransactionId || null,
            amountPaidFcfa,
            paidAt,
          },
          completedAt: paidAt,
        },
      });
      attemptId = attempt.id;

      await tx.payment.update({ where: { id: paymentId }, data: { lastAttemptId: attemptId } });
    }

    const updatedOrder = await tx.preorder.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        paymentStatus: "PAID",
        preorderPaymentMode: "WAVE",
        paymentProvider: "WAVE",
        paidAt,
        activePaymentId: paymentId,
        billingWorkStatus: "COMPLETED",
        billingCompletedAt: order.billingCompletedAt || now,
        billingLastActivityAt: now,
      },
    });

    await tx.preorderLog.create({
      data: {
        preorderId: order.id,
        action: "PAYMENT_CONFIRMED",
        note: `Paiement externe ${link.reference} rattaché à la commande (rattachement manuel exceptionnel, écart de ${gapFcfa} F accepté — compensé par une autre paire du même jour).`,
        actorAdminId: null,
        meta: {
          source: "EXTERNAL_PAYMENT_LINK_ATTACH_MANUAL_EXCEPTION",
          externalPaymentLinkId: link.id,
          externalPaymentReference: link.reference,
          externalInvoiceReference: link.invoiceReference,
          providerSessionId: link.providerSessionId || null,
          providerTransactionId: link.providerTransactionId || null,
          amountPaidFcfa,
          invoiceAmountFcfa,
          orderTotalFcfa: Number(order.totalFcfa || 0),
          amountGapFcfa: gapFcfa,
          paymentId,
          paymentAttemptId: attemptId,
        },
      },
    });

    await tx.externalPaymentLink.update({
      where: { id: link.id },
      data: {
        description: [
          link.description,
          `Rattaché manuellement à la commande ${order.preorderNumber} le ${now.toISOString()} (écart de ${gapFcfa} F accepté à titre exceptionnel).`,
        ].filter(Boolean).join("\n"),
      },
    });

    return { order: updatedOrder, paymentId, paymentAttemptId: attemptId };
  }, { isolationLevel: "Serializable", timeout: 20000, maxWait: 10000 });

  console.log(`[OK] ${linkReference} -> ${preorderNumber} : paiement ${amountPaidFcfa} F rattaché, commande totale ${order.totalFcfa} F (écart ${gapFcfa} F), paymentId=${result.paymentId}`);
}

async function main() {
  for (const pair of PAIRS) {
    await reconcilePair(pair);
  }
}

main()
  .catch((error) => {
    console.error("[ERREUR]", error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
