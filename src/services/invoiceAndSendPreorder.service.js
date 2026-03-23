// src/services/orders/invoiceAndSendPreorder.service.js
//
// Version réécrite pour le nouveau schéma :
// - plus de PaymentMode
// - plus de paymentLink / paymentRef sur Preorder
// - plus d'appel direct à PayDunya
// - facturation = SUBMITTED -> INVOICED
// - met la commande en attente de paiement côté file facturier
// - conserve OrderMessage pour l'envoi WhatsApp

const prisma = require("../prisma");
const whatsappService = require("./whatsapp.service");
const paymentsService = require("../payments/payments.service");

/**
 * Génère une référence de préfacture lisible
 * Exemple: PF-2026-AB12CD
 */
function generateInvoiceRef(preorder) {
  const year = new Date().getFullYear();
  const shortId = String(preorder.id || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6)
    .toUpperCase();

  return `PF-${year}-${shortId}`;
}

/**
 * Essaie de trouver le numéro WhatsApp du FBO
 */
function resolveWhatsappTo(preorder, whatsappToInput) {
  if (whatsappToInput && String(whatsappToInput).trim()) {
    return String(whatsappToInput).trim();
  }

  if (preorder.factureWhatsappTo && String(preorder.factureWhatsappTo).trim()) {
    return String(preorder.factureWhatsappTo).trim();
  }

  return null;
}

/**
 * Crée un log métier standard dans PreorderLog
 */
async function createPreorderLog(tx, { preorderId, action, note, meta, actorAdminId }) {
  await tx.preorderLog.create({
    data: {
      preorderId,
      action,
      note: note || null,
      meta: meta || null,
      actorAdminId: actorAdminId || null,
    },
  });
}

/**
 * Détermine si la précommande doit utiliser Wave
 */
function isWavePreorder(preorder) {
  const mode = String(
    preorder?.preorderPaymentMode ||
      preorder?.paymentMode ||
      preorder?.paymentProvider ||
      ""
  )
    .trim()
    .toUpperCase();

  return (
    mode === "WAVE" ||
    mode.includes("WAVE") ||
    mode.includes("MOBILE") ||
    mode.includes("MOMO")
  );
}

/**
 * Construit le message WhatsApp de facturation.
 * Si paymentLink est fourni, il sera intégré dans le message.
 */
function buildInvoiceMessage({ preorder, invoiceRef, note, paymentLink }) {
  if (typeof whatsappService.buildInvoiceWhatsAppMessage === "function") {
    return whatsappService.buildInvoiceWhatsAppMessage({
      customerName: preorder.fboNomComplet || preorder.fbo?.nomComplet || "",
      fboNumero: preorder.fboNumero,
      invoiceRef,
      totalFcfa: preorder.totalFcfa,
      paymentLink: paymentLink || null,
      paymentMode:
        preorder.preorderPaymentMode ||
        preorder.paymentMode ||
        preorder.paymentProvider ||
        null,
      note: note || "",
    });
  }

  return [
    `Bonjour ${preorder.fboNomComplet || ""},`,
    "",
    `Votre précommande FOREVER a été facturée.`,
    `Référence facture : ${invoiceRef}`,
    `Montant : ${preorder.totalFcfa} FCFA`,
    paymentLink ? `Lien de paiement : ${paymentLink}` : null,
    note ? `Note : ${note}` : null,
    "",
    "Merci.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Service principal
 */
async function invoiceAndSendPreorder({
  req,
  preorderId,
  actorName = "ADMIN",
  actorAdminId = null,
  invoiceRefInput = "",
  whatsappToInput = "",
  invoiceNote = "",
}) {
  if (!preorderId) {
    throw new Error("PREORDER_ID_REQUIRED");
  }

  const now = new Date();

  // 1) On charge d'abord la commande hors transaction principale
  const existingPreorder = await prisma.preorder.findUnique({
    where: { id: preorderId },
    include: {
      fbo: true,
      items: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!existingPreorder) {
    throw new Error("PREORDER_NOT_FOUND");
  }

  if (existingPreorder.status !== "SUBMITTED") {
    throw new Error("PREORDER_NOT_INVOICEABLE");
  }

  const invoiceRef =
    String(invoiceRefInput || "").trim() ||
    existingPreorder.factureReference ||
    generateInvoiceRef(existingPreorder);

  const whatsappTo = resolveWhatsappTo(existingPreorder, whatsappToInput);

  // 2) On facture d'abord la commande sans envoyer tout de suite le message
  const invoicedPreorder = await prisma.$transaction(async (tx) => {
    const updatedPreorder = await tx.preorder.update({
      where: { id: existingPreorder.id },
      data: {
        status: "INVOICED",
        factureReference: invoiceRef,
        factureWhatsappTo: whatsappTo,
        invoicedAt: now,
        invoicedById: actorAdminId || existingPreorder.invoicedById || null,

        // file facturier
        assignedInvoicerId:
          existingPreorder.assignedInvoicerId || actorAdminId || null,
        assignedAt:
          existingPreorder.assignedAt ||
          (actorAdminId ? now : existingPreorder.assignedAt),
        billingStartedAt: existingPreorder.billingStartedAt || now,
        billingLastActivityAt: now,
        billingWorkStatus: "WAITING_PAYMENT",
      },
      include: {
        fbo: true,
        items: true,
      },
    });

    await createPreorderLog(tx, {
      preorderId: existingPreorder.id,
      action: "INVOICE",
      note: "Précommande facturée.",
      meta: {
        invoiceRef,
        whatsappTo,
        actorName,
      },
      actorAdminId,
    });

    return updatedPreorder;
  });

  // 3) Si la commande est Wave, on initie Wave MAINTENANT
  let waveResult = null;
  let paymentLink = null;

  if (isWavePreorder(invoicedPreorder) && req) {
    waveResult = await paymentsService.initiateWavePayment({
      req,
      preorderId: invoicedPreorder.id,
    });

    paymentLink = waveResult?.checkoutUrl || null;
  }

  // 4) Maintenant seulement on construit le message final avec le lien si dispo
  const messagePurpose = paymentLink ? "PAYMENT_LINK" : "INVOICE";

  const whatsappMessage = buildInvoiceMessage({
    preorder: invoicedPreorder,
    invoiceRef,
    note: invoiceNote,
    paymentLink,
  });

  // 5) On crée et envoie le message WhatsApp final
  const finalResult = await prisma.$transaction(async (tx) => {
    const createdMessage = await tx.orderMessage.create({
      data: {
        preorderId: invoicedPreorder.id,
        purpose: messagePurpose,
        status: "QUEUED",
        toPhone: whatsappTo,
        provider: "SIMULATED",
        paymentLinkTarget: paymentLink,
        paymentLinkTracked: paymentLink,
        createdBy: actorName,
        body: whatsappMessage,
      },
    });

    let sendResult = {
      accepted: false,
      provider: "SIMULATED",
      providerMessageId: null,
      rawPayload: null,
      errorCode: "NO_DESTINATION",
      errorMessage: "Aucun numéro WhatsApp disponible pour cette précommande.",
    };

    if (whatsappTo) {
      if (typeof whatsappService.sendTextMessage === "function") {
        sendResult = await whatsappService.sendTextMessage({
          to: whatsappTo,
          body: whatsappMessage,
          metadata: {
            preorderId: invoicedPreorder.id,
            orderMessageId: createdMessage.id,
            purpose: messagePurpose,
          },
        });
      } else {
        sendResult = {
          accepted: true,
          provider: "SIMULATED",
          providerMessageId: `sim_${createdMessage.id}`,
          rawPayload: null,
          errorCode: null,
          errorMessage: null,
        };
      }
    }

    const finalMessageStatus = sendResult.accepted ? "SENT" : "FAILED";

    const savedMessage = await tx.orderMessage.update({
      where: { id: createdMessage.id },
      data: {
        status: finalMessageStatus,
        provider: sendResult.provider || "SIMULATED",
        providerMessageId: sendResult.providerMessageId || null,
        sentAt: sendResult.accepted ? now : null,
        failedAt: sendResult.accepted ? null : now,
        lastStatusAt: now,
        errorCode: sendResult.errorCode || null,
        errorMessage: sendResult.errorMessage || null,
      },
    });

    await tx.orderMessageEvent.create({
      data: {
        orderMessageId: savedMessage.id,
        status: finalMessageStatus,
        rawPayload: sendResult.rawPayload || null,
        note: sendResult.accepted
          ? "Message WhatsApp de facturation envoyé."
          : "Échec de l’envoi WhatsApp de facturation.",
      },
    });

    const updatedPreorder = await tx.preorder.update({
      where: { id: invoicedPreorder.id },
      data: {
        whatsappMessage,
        lastWhatsappMessageId: savedMessage.id,
        lastWhatsappStatus: finalMessageStatus,
        lastWhatsappStatusAt: now,
        billingLastActivityAt: now,
      },
    });

    await createPreorderLog(tx, {
      preorderId: invoicedPreorder.id,
      action: "INVOICE",
      note: sendResult.accepted
        ? paymentLink
          ? "Précommande facturée, paiement Wave initié et message WhatsApp envoyé."
          : "Précommande facturée et message WhatsApp envoyé."
        : paymentLink
          ? "Précommande facturée, paiement Wave initié, mais envoi WhatsApp en échec."
          : "Précommande facturée, mais envoi WhatsApp en échec.",
      meta: {
        invoiceRef,
        whatsappTo,
        messageId: savedMessage.id,
        messagePurpose,
        messageStatus: finalMessageStatus,
        actorName,
        paymentLink,
        waveSessionId: waveResult?.paymentAttempt?.providerSessionId || null,
      },
      actorAdminId,
    });

    return {
      preorder: updatedPreorder,
      billingMessage: savedMessage,
      whatsappStatus: finalMessageStatus,
      whatsappTo,
      paymentLinkTarget: paymentLink,
      trackedPaymentLink: paymentLink,
      paymentRef:
        waveResult?.payment?.providerReference ||
        waveResult?.paymentAttempt?.providerSessionId ||
        null,
    };
  });

  return finalResult;
}

module.exports = {
  invoiceAndSendPreorder,
  generateInvoiceRef,
};