// src/services/invoiceAndSendPreorder.service.js
//
// Version réécrite pour le nouveau schéma :
// - plus de PaymentMode
// - plus de paymentLink / paymentRef sur Preorder
// - plus d'appel direct à PayDunya
// - facturation = SUBMITTED -> INVOICED
// - met la commande en attente de paiement côté file facturier
// - conserve OrderMessage pour l'envoi WhatsApp
// - initie Wave AVANT de construire/envoyer le message WhatsApp
// - garantit l'injection du lien de paiement dans le message final

const prisma = require("../prisma");
const whatsappService = require("./whatsapp.service");
const paymentsService = require("../payments/payments.service");
const { sendSms } = require("./sms.service");
const { computePreorderTotalsForGrade } = require("./pricing.service");
const { computePaymentPricing } = require("../payments/payment-pricing");

const BILLING_GRADES = [
  "CLIENT_PRIVILEGIE",
  "ANIMATEUR_ADJOINT",
  "ANIMATEUR",
  "MANAGER_ADJOINT",
  "MANAGER",
];

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
async function createPreorderLog(
  tx,
  { preorderId, action, note, meta, actorAdminId },
) {
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
      "",
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

function normalizeBillingGrade(value, fallback) {
  const grade = String(value || fallback || "")
    .trim()
    .toUpperCase();

  if (!grade) {
    throw new Error("INVALID_FBO_GRADE");
  }

  if (!BILLING_GRADES.includes(grade)) {
    throw new Error("INVALID_FBO_GRADE");
  }

  return grade;
}

function normalizeInvoiceAmountOverride(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }

  const normalizedValue = String(value)
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");
  const amount = Number(normalizedValue);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("INVALID_INVOICE_AMOUNT");
  }

  return Math.round(amount);
}

async function buildInvoicePreview({
  preorderId,
  billingGradeInput = "",
  invoiceAmountOverrideInput = "",
}) {
  const preorder = await prisma.preorder.findUnique({
    where: { id: preorderId },
    select: {
      id: true,
      status: true,
      countryId: true,
      fboGrade: true,
      preorderPaymentMode: true,
    },
  });

  if (!preorder) {
    throw new Error("PREORDER_NOT_FOUND");
  }

  const effectiveGrade = normalizeBillingGrade(
    billingGradeInput,
    preorder.fboGrade,
  );

  const pricingSummary = await computePreorderTotalsForGrade(
    preorder.id,
    preorder.countryId,
    effectiveGrade,
  );
  const invoiceAmountOverrideFcfa = normalizeInvoiceAmountOverride(
    invoiceAmountOverrideInput,
  );
  const effectiveInvoiceTotalFcfa =
    invoiceAmountOverrideFcfa ?? pricingSummary.totals.totalFcfa;

  const paymentPricing = computePaymentPricing({
    preorderPaymentMode: preorder.preorderPaymentMode,
    orderTotalFcfa: effectiveInvoiceTotalFcfa,
  });

  return {
    preorderId: preorder.id,
    status: preorder.status,
    previousGrade: preorder.fboGrade,
    effectiveGrade,
    discountPercent: pricingSummary.discountPercent,
    totals: {
      ...pricingSummary.totals,
      totalFcfa: effectiveInvoiceTotalFcfa,
    },
    pricingTotals: pricingSummary.totals,
    invoiceAmountOverrideFcfa,
    effectiveInvoiceTotalFcfa,
    payment: paymentPricing,
  };
}

/**
 * Construit le message de facturation.
 * Si paymentLink est fourni, il sera intégré dans le message.
 */
function buildInvoiceMessage({
  preorder,
  invoiceRef,
  note,
  paymentLink,
  amountToPayFcfa,
  paymentServiceFeeFcfa = 0,
  serviceFeeRatePercent = 0,
}) {
  const payableAmount = Number(amountToPayFcfa ?? preorder.totalFcfa ?? 0);

  if (typeof whatsappService.buildInvoiceWhatsAppMessage === "function") {
    return whatsappService.buildInvoiceWhatsAppMessage({
      customerName: preorder.fboNomComplet || preorder.fbo?.nomComplet || "",
      fboNumero: preorder.fboNumero,
      invoiceRef,
      totalFcfa: payableAmount,
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
    "Votre précommande FOREVER a été facturée.",
    `Référence facture : ${invoiceRef}`,
    `Montant commande : ${preorder.totalFcfa} FCFA`,
    paymentServiceFeeFcfa > 0
      ? `Frais de service ${serviceFeeRatePercent}% : ${paymentServiceFeeFcfa} FCFA`
      : null,
    `Montant final à payer : ${payableAmount} FCFA`,
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
  billingGradeInput = "",
  invoiceAmountOverrideInput = "",
}) {
  if (!preorderId) {
    throw new Error("PREORDER_ID_REQUIRED");
  }

  const now = new Date();

  // 1) Charger la commande
  const existingPreorder = await prisma.preorder.findUnique({
    where: { id: preorderId },
    include: {
      fbo: true,
      country: {
        select: {
          code: true,
        },
      },
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
  const effectiveGrade = normalizeBillingGrade(
    billingGradeInput,
    existingPreorder.fboGrade,
  );
  const pricingSummary = await computePreorderTotalsForGrade(
    existingPreorder.id,
    existingPreorder.countryId,
    effectiveGrade,
  );
  const invoiceAmountOverrideFcfa = normalizeInvoiceAmountOverride(
    invoiceAmountOverrideInput,
  );
  const effectiveInvoiceTotalFcfa =
    invoiceAmountOverrideFcfa ?? pricingSummary.totals.totalFcfa;
  const paymentPricing = computePaymentPricing({
    preorderPaymentMode: existingPreorder.preorderPaymentMode,
    orderTotalFcfa: effectiveInvoiceTotalFcfa,
  });

  // 2) Facturer la commande
  const invoicedPreorder = await prisma.$transaction(async (tx) => {
    for (const it of pricingSummary.items) {
      await tx.preorderItem.update({
        where: {
          preorderId_productId: {
            preorderId: existingPreorder.id,
            productId: it.productId,
          },
        },
        data: {
          productSkuSnapshot: it.sku || null,
          productNameSnapshot: it.nom || null,
          prixCatalogueFcfa:
            it.prixCatalogueFcfa != null
              ? it.prixCatalogueFcfa
              : it.prixUnitaireFcfa,
          discountPercent: String(Number(it.discountPercent || 0).toFixed(2)),
          prixUnitaireFcfa: it.prixUnitaireFcfa,
          ccUnitaire: String(Number(it.ccUnitaire || 0).toFixed(3)),
          poidsUnitaireKg: String(Number(it.poidsUnitaireKg || 0).toFixed(3)),
          lineTotalFcfa: it.lineTotalFcfa,
          lineTotalCc: String(Number(it.lineTotalCc || 0).toFixed(3)),
          lineTotalPoids: String(Number(it.lineTotalPoids || 0).toFixed(3)),
        },
      });
    }

    const updatedPreorder = await tx.preorder.update({
      where: { id: existingPreorder.id },
      data: {
        status: "INVOICED",
        fboGrade: effectiveGrade,
        factureReference: invoiceRef,
        factureWhatsappTo: whatsappTo,
        invoicedAt: now,
        invoicedById: actorAdminId || existingPreorder.invoicedById || null,
        totalCc: String(Number(pricingSummary.totals.totalCc || 0).toFixed(3)),
        totalPoidsKg: String(
          Number(pricingSummary.totals.totalPoidsKg || 0).toFixed(3),
        ),
        totalProduitsFcfa: pricingSummary.totals.totalProduitsFcfa || 0,
        fraisLivraisonFcfa: pricingSummary.totals.fraisLivraisonFcfa || 0,
        totalFcfa: effectiveInvoiceTotalFcfa || 0,

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
        previousGrade: existingPreorder.fboGrade,
        effectiveGrade,
        discountPercent: pricingSummary.discountPercent,
        computedTotalFcfa: pricingSummary.totals.totalFcfa || 0,
        invoiceAmountOverrideFcfa,
        totalFcfa: effectiveInvoiceTotalFcfa || 0,
        paymentServiceFeeFcfa: paymentPricing.paymentServiceFeeFcfa,
        amountToPayFcfa: paymentPricing.amountToPayFcfa,
        actorName,
      },
      actorAdminId,
    });

    return updatedPreorder;
  });

  // 🔍 Logs déplacés ici (correct)
  console.log("[invoiceAndSendPreorder] preorderPaymentMode =", invoicedPreorder?.preorderPaymentMode);
  console.log("[invoiceAndSendPreorder] paymentMode =", invoicedPreorder?.paymentMode);
  console.log("[invoiceAndSendPreorder] paymentProvider =", invoicedPreorder?.paymentProvider);
  console.log("[invoiceAndSendPreorder] isWavePreorder =", isWavePreorder(invoicedPreorder));
  console.log("[invoiceAndSendPreorder] hasReq =", Boolean(req));

  // 3) Générer le lien public de paiement Wave si nécessaire
  let paymentLink = null;

  if (isWavePreorder(invoicedPreorder) && req) {
    paymentLink = paymentsService.buildPublicWavePaymentUrl(
      invoicedPreorder.id,
      invoicedPreorder.country?.code || "CIV",
    );
  }

  // 4) Construire le message SMS/WhatsApp historique
  const messagePurpose = paymentLink ? "PAYMENT_LINK" : "INVOICE";

  let whatsappMessage = buildInvoiceMessage({
    preorder: invoicedPreorder,
    invoiceRef,
    note: invoiceNote,
    paymentLink,
    amountToPayFcfa: paymentPricing.amountToPayFcfa,
    paymentServiceFeeFcfa: paymentPricing.paymentServiceFeeFcfa,
    serviceFeeRatePercent: paymentPricing.serviceFeeRatePercent,
  });

  if (paymentLink && !String(whatsappMessage || "").includes(paymentLink)) {
    whatsappMessage = [
      String(whatsappMessage || "").trim(),
      "",
      "Lien de paiement Wave :",
      paymentLink,
    ]
      .filter(Boolean)
      .join("\n");
  }

  // 🔍 Logs déplacés ici (correct)
  console.log("[invoiceAndSendPreorder] messagePurpose =", messagePurpose);
  console.log("[invoiceAndSendPreorder] body to save =", whatsappMessage);

  console.log("[invoiceAndSendPreorder] paymentLink =", paymentLink);

  // 5) Envoi SMS + logs + mise à jour
  const finalResult = await prisma.$transaction(async (tx) => {
    const createdMessage = await tx.orderMessage.create({
      data: {
        preorderId: invoicedPreorder.id,
        purpose: messagePurpose,
        status: "QUEUED",
        toPhone: whatsappTo,
        provider: "ORANGE",
        paymentLinkTarget: paymentLink,
        paymentLinkTracked: paymentLink,
        createdBy: actorName,
        body: whatsappMessage,
      },
    });

    let sendResult = {
      accepted: false,
      provider: "ORANGE",
      providerMessageId: null,
      rawPayload: null,
      errorCode: "NO_DESTINATION",
      errorMessage: "Aucun numero de destination disponible pour cette precommande.",
    };

    if (whatsappTo) {
      sendResult = await sendSms({
        to: whatsappTo,
        message: whatsappMessage,
        callbackData: invoicedPreorder.id,
      });
    }

    console.log("[invoiceAndSendPreorder] billingMessage =", whatsappMessage);

    const finalMessageStatus = sendResult.accepted ? "SENT" : "FAILED";

    const savedMessage = await tx.orderMessage.update({
      where: { id: createdMessage.id },
      data: {
        status: finalMessageStatus,
        provider: sendResult.provider || "ORANGE",
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
          ? "Message SMS de facturation envoye."
          : "Echec de l'envoi SMS de facturation.",
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
          ? "Precommande facturee, paiement Wave initie et SMS envoye."
          : "Precommande facturee et SMS envoye."
        : paymentLink
          ? "Precommande facturee, paiement Wave initie, mais envoi SMS en echec."
          : "Precommande facturee, mais envoi SMS en echec.",
      meta: {
        invoiceRef,
        whatsappTo,
        previousGrade: existingPreorder.fboGrade,
        effectiveGrade,
        discountPercent: pricingSummary.discountPercent,
        computedTotalFcfa: pricingSummary.totals.totalFcfa || 0,
        invoiceAmountOverrideFcfa,
        totalFcfa: effectiveInvoiceTotalFcfa || 0,
        paymentServiceFeeFcfa: paymentPricing.paymentServiceFeeFcfa,
        amountToPayFcfa: paymentPricing.amountToPayFcfa,
        messageId: savedMessage.id,
        messagePurpose,
        messageStatus: finalMessageStatus,
        actorName,
        paymentLink,
        waveSessionId: null,
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
      paymentRef: null,
      paymentPricing,
    };
  });

  return finalResult;
}

module.exports = {
  invoiceAndSendPreorder,
  generateInvoiceRef,
  buildInvoicePreview,
  computePaymentPricing,
  normalizeInvoiceAmountOverride,
};
