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
 * Construit le message WhatsApp de facturation.
 * On garde la compatibilité avec le service existant en envoyant
 * paymentLink = null tant que le moteur de paiement n'est pas branché.
 */
function buildInvoiceMessage({ preorder, invoiceRef, note }) {
  if (typeof whatsappService.buildInvoiceWhatsAppMessage === "function") {
    return whatsappService.buildInvoiceWhatsAppMessage({
      customerName: preorder.fboNomComplet || preorder.fbo?.nomComplet || "",
      fboNumero: preorder.fboNumero,
      invoiceRef,
      totalFcfa: preorder.totalFcfa,
      paymentLink: null,
      paymentMode: null,
      note: note || "",
    });
  }

  return [
    `Bonjour ${preorder.fboNomComplet || ""},`,
    "",
    `Votre précommande FOREVER a été facturée.`,
    `Référence facture : ${invoiceRef}`,
    `Montant : ${preorder.totalFcfa} FCFA`,
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

  return prisma.$transaction(async (tx) => {
    const preorder = await tx.preorder.findUnique({
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

    if (!preorder) {
      throw new Error("PREORDER_NOT_FOUND");
    }

    if (preorder.status !== "SUBMITTED") {
      throw new Error("PREORDER_NOT_INVOICEABLE");
    }

    const invoiceRef =
      String(invoiceRefInput || "").trim() ||
      preorder.factureReference ||
      generateInvoiceRef(preorder);

    const whatsappTo = resolveWhatsappTo(preorder, whatsappToInput);
    const messagePurpose = "INVOICE";
    const now = new Date();

    const createdMessage = await tx.orderMessage.create({
      data: {
        preorderId: preorder.id,
        purpose: messagePurpose,
        status: "QUEUED",
        toPhone: whatsappTo,
        provider: "SIMULATED",
        paymentLinkTarget: null,
        paymentLinkTracked: null,
        createdBy: actorName,
      },
    });

    const whatsappMessage = buildInvoiceMessage({
      preorder,
      invoiceRef,
      note: invoiceNote,
    });

    await tx.orderMessage.update({
      where: { id: createdMessage.id },
      data: {
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
            preorderId: preorder.id,
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
      where: { id: preorder.id },
      data: {
        status: "INVOICED",
        factureReference: invoiceRef,
        factureWhatsappTo: whatsappTo,
        whatsappMessage: whatsappMessage,
        invoicedAt: now,
        invoicedById: actorAdminId || preorder.invoicedById || null,

        // file facturier
        assignedInvoicerId: preorder.assignedInvoicerId || actorAdminId || null,
        assignedAt: preorder.assignedAt || (actorAdminId ? now : preorder.assignedAt),
        billingStartedAt: preorder.billingStartedAt || now,
        billingLastActivityAt: now,
        billingWorkStatus: "WAITING_PAYMENT",

        // suivi message
        lastWhatsappMessageId: savedMessage.id,
        lastWhatsappStatus: finalMessageStatus,
        lastWhatsappStatusAt: now,
      },
    });

    await createPreorderLog(tx, {
      preorderId: preorder.id,
      action: "INVOICE",
      note: sendResult.accepted
        ? "Précommande facturée et message WhatsApp envoyé."
        : "Précommande facturée, mais envoi WhatsApp en échec.",
      meta: {
        invoiceRef,
        whatsappTo,
        messageId: savedMessage.id,
        messagePurpose,
        messageStatus: finalMessageStatus,
        actorName,
      },
      actorAdminId,
    });

    return {
      preorder: updatedPreorder,
      billingMessage: savedMessage,
      whatsappStatus: finalMessageStatus,
      whatsappTo,
      paymentLinkTarget: null,
      trackedPaymentLink: null,
      paymentRef: null,
    };
  });
}

module.exports = {
  invoiceAndSendPreorder,
  generateInvoiceRef,
};