// src/services/orders/invoiceAndSendPreorder.service.js

const {
  PrismaClient,
  PreorderLogAction,
  PaymentMode,
} = require("@prisma/client");

const prisma = new PrismaClient();

const whatsappService = require("./whatsapp.service");
const { createPaydunyaPayment } = require("./paydunya.service");

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
 * Détermine si le mode de paiement est espèces
 */
function isCashPayment(paymentMode) {
  return paymentMode === PaymentMode.ESPECES;
}

/**
 * Crée un vrai lien PayDunya + token de paiement
 */
async function createPaymentLinkForPreorder(preorder, invoiceRef, whatsappTo) {
  const payment = await createPaydunyaPayment({
    orderId: preorder.id,
    amount: preorder.totalFcfa,
    description: `Précommande ${preorder.fboNumero} - ${preorder.totalFcfa} FCFA`,
    customerName: preorder.fboNomComplet,
    customerPhone: whatsappTo || undefined,
    customData: {
      preorderId: preorder.id,
      fboNumero: preorder.fboNumero,
      countryId: preorder.countryId,
      invoiceRef,
    },
  });

  return {
    paymentLink: payment.paymentUrl,
    paymentRef: payment.token,
    raw: payment.raw,
  };
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
async function createPreorderLog(tx, { preorderId, action, note, meta }) {
  await tx.preorderLog.create({
    data: {
      preorderId,
      action,
      note: note || null,
      meta: meta || null,
    },
  });
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

  const appBaseUrl =
    process.env.APP_BASE_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:5173";

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
    const cash = isCashPayment(preorder.paymentMode);

    let paymentLinkTarget = null;
    let paymentRef = null;

    if (!cash) {
      const payment = await createPaymentLinkForPreorder(
        preorder,
        invoiceRef,
        whatsappTo
      );

      paymentLinkTarget = payment.paymentLink;
      paymentRef = payment.paymentRef;
    }

    const messagePurpose = cash ? "INVOICE" : "PAYMENT_LINK";

    const createdMessage = await tx.orderMessage.create({
      data: {
        preorderId: preorder.id,
        purpose: messagePurpose,
        status: "QUEUED",
        toPhone: whatsappTo,
        provider: "SIMULATED",
        paymentLinkTarget,
        createdBy: actorName,
      },
    });

    // Conservé pour une future évolution de tracking, mais non utilisé dans le message FBO
    const trackedPaymentLink = !cash
      ? `${appBaseUrl}/pay/o/${preorder.id}/${createdMessage.id}`
      : null;

    // ✅ Le message envoyé au FBO contient le vrai lien PayDunya
    const whatsappMessage = whatsappService.buildInvoiceWhatsAppMessage({
      customerName: preorder.fboNomComplet || preorder.fbo?.nomComplet,
      fboNumero: preorder.fboNumero,
      invoiceRef,
      totalFcfa: preorder.totalFcfa,
      paymentLink: paymentLinkTarget,
      paymentMode: preorder.paymentMode,
      note: invoiceNote,
    });

    await tx.orderMessage.update({
      where: { id: createdMessage.id },
      data: {
        body: whatsappMessage,
        paymentLinkTracked: trackedPaymentLink,
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
      sendResult = await whatsappService.sendTextMessage({
        to: whatsappTo,
        body: whatsappMessage,
        metadata: {
          preorderId: preorder.id,
          orderMessageId: createdMessage.id,
          purpose: messagePurpose,
        },
      });
    }

    const now = new Date();
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
        paymentLink: paymentLinkTarget,
        paymentRef: paymentRef,
        whatsappMessage: whatsappMessage,
        invoicedAt: now,
        invoicedBy: actorName,
        invoicedById: actorAdminId || null,
        lastWhatsappMessageId: savedMessage.id,
        lastWhatsappStatus: finalMessageStatus,
        lastWhatsappStatusAt: now,
      },
    });

    await createPreorderLog(tx, {
      preorderId: preorder.id,
      action: PreorderLogAction.INVOICE,
      note: sendResult.accepted
        ? "Précommande facturée et message WhatsApp envoyé."
        : "Précommande facturée, mais envoi WhatsApp en échec.",
      meta: {
        invoiceRef,
        whatsappTo,
        messageId: savedMessage.id,
        messagePurpose,
        messageStatus: finalMessageStatus,
        paymentLinkTarget,
        paymentLinkTracked: trackedPaymentLink,
        paymentRef,
        paymentMode: preorder.paymentMode,
        actorName,
      },
    });

    return {
      preorder: updatedPreorder,
      billingMessage: savedMessage,
      whatsappStatus: finalMessageStatus,
      whatsappTo,
      paymentLinkTarget,
      trackedPaymentLink,
      paymentRef,
    };
  });
}

module.exports = {
  invoiceAndSendPreorder,
  generateInvoiceRef,
};