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
const paymentsService = require("../payments/payments.service");
const { MAX_SMS_LENGTH } = require("./sms.orange.service");
const { computePreorderTotalsForGrade } = require("./pricing.service");
const { computePaymentPricing } = require("../payments/payment-pricing");
const { sendPreorderNotification } = require("./preorder-notifications.service");

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

function normalizeAdjustmentReason(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function compactText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSmsCandidate(candidates = [], maxLength = MAX_SMS_LENGTH) {
  for (const raw of candidates) {
    const candidate = compactText(raw);
    if (!candidate) continue;
    if (candidate.length <= maxLength) return candidate;
  }
  return compactText(candidates[0] || "").slice(0, maxLength);
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
  const indicativeTotalFcfa = Number(preorder.totalFcfa || 0);
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
    indicativeTotalFcfa,
    discountPercent: pricingSummary.discountPercent,
    totals: {
      ...pricingSummary.totals,
      totalFcfa: effectiveInvoiceTotalFcfa,
    },
    pricingTotals: pricingSummary.totals,
    invoiceAmountOverrideFcfa,
    effectiveInvoiceTotalFcfa,
    requiresAdjustmentReason:
      preorder.fboGrade !== effectiveGrade ||
      effectiveInvoiceTotalFcfa !== Number(pricingSummary.totals.totalFcfa || 0),
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
  const ref = compactText(invoiceRef || preorder?.factureReference || "-")
    .replace(/\s+/g, "")
    .slice(0, 24);
  const amountFmt = new Intl.NumberFormat("fr-FR").format(
    Math.max(0, Math.round(payableAmount || 0)),
  );
  const normalizedLink = compactText(paymentLink || "");
  const normalizedMode = String(
    preorder?.preorderPaymentMode ||
      preorder?.paymentMode ||
      preorder?.paymentProvider ||
      "",
  )
    .trim()
    .toUpperCase();
  const isCashFlow = normalizedMode.includes("ESPE") || normalizedMode === "MANUAL";

  if (normalizedLink && !isCashFlow) {
    return firstSmsCandidate([
      `FOREVER Ref:${ref} Total:${amountFmt}F Lien:${normalizedLink}`,
      `Ref:${ref} Total:${amountFmt}F ${normalizedLink}`,
      `Ref:${ref} ${normalizedLink}`,
    ]);
  }

  return firstSmsCandidate([
    `FOREVER Ref:${ref} Total:${amountFmt}F Paiement en caisse FLP.`,
    `Ref:${ref} Total:${amountFmt}F Paiement caisse.`,
    `Ref:${ref} Facture disponible.`,
  ]);
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
  billingAdjustmentReasonInput = "",
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

  const invoiceRef = String(invoiceRefInput || "").trim();
  if (!invoiceRef) {
    throw new Error("INVOICE_REFERENCE_REQUIRED");
  }

  const whatsappTo = resolveWhatsappTo(existingPreorder, whatsappToInput);
  const effectiveGrade = normalizeBillingGrade(
    billingGradeInput,
    existingPreorder.billingGrade || existingPreorder.fboGrade,
  );
  const indicativeTotalFcfa = Number(
    existingPreorder.as400InvoiceTotalFcfa ??
      existingPreorder.indicativeTotalFcfa ??
      existingPreorder.totalFcfa ??
      0,
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
  const billingAdjustmentReason = normalizeAdjustmentReason(
    billingAdjustmentReasonInput,
  );
  const requiresAdjustmentReason =
    existingPreorder.fboGrade !== effectiveGrade ||
    effectiveInvoiceTotalFcfa !== Number(pricingSummary.totals.totalFcfa || 0);
  if (requiresAdjustmentReason && !billingAdjustmentReason) {
    throw new Error("BILLING_ADJUSTMENT_REASON_REQUIRED");
  }
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
        billingGrade: effectiveGrade,
        factureReference: invoiceRef,
        factureWhatsappTo: whatsappTo,
        indicativeTotalFcfa,
        computedGradeTotalFcfa: pricingSummary.totals.totalFcfa || 0,
        as400InvoiceTotalFcfa: effectiveInvoiceTotalFcfa || 0,
        billingAdjustmentReason,
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
        indicativeTotalFcfa,
        discountPercent: pricingSummary.discountPercent,
        computedTotalFcfa: pricingSummary.totals.totalFcfa || 0,
        invoiceAmountOverrideFcfa,
        totalFcfa: effectiveInvoiceTotalFcfa || 0,
        billingAdjustmentReason,
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

  // 🔍 Logs déplacés ici (correct)
  console.log("[invoiceAndSendPreorder] messagePurpose =", messagePurpose);
  console.log("[invoiceAndSendPreorder] body to save =", whatsappMessage);

  console.log("[invoiceAndSendPreorder] paymentLink =", paymentLink);

  // 5) Envoi notification (fallback SMS -> WhatsApp -> Email) + logs + mise à jour
  const notificationResult = await sendPreorderNotification({
    preorder: {
      ...invoicedPreorder,
      factureWhatsappTo: whatsappTo,
    },
    purpose: messagePurpose,
    message: whatsappMessage,
    actorName,
    toPhone: whatsappTo,
    paymentLinkTarget: paymentLink,
    paymentLinkTracked: paymentLink,
  });

  console.log("[invoiceAndSendPreorder] billingMessage =", whatsappMessage);

  const finalMessageStatus = notificationResult.sent ? "SENT" : "FAILED";

  const updatedPreorder = await prisma.$transaction(async (tx) => {
    const nextPreorder = await tx.preorder.update({
      where: { id: invoicedPreorder.id },
      data: {
        whatsappMessage,
        lastWhatsappMessageId: notificationResult.providerMessageId || null,
        lastWhatsappStatus: finalMessageStatus,
        lastWhatsappStatusAt: now,
        billingLastActivityAt: now,
      },
    });

    await createPreorderLog(tx, {
      preorderId: invoicedPreorder.id,
      action: "INVOICE",
      note: notificationResult.sent
        ? paymentLink
          ? "Precommande facturee, paiement Wave initie et notification envoyee."
          : "Precommande facturee et notification envoyee."
        : paymentLink
          ? "Precommande facturee, paiement Wave initie, mais echec de notification."
          : "Precommande facturee, mais echec de notification.",
      meta: {
        invoiceRef,
        whatsappTo,
        previousGrade: existingPreorder.fboGrade,
        effectiveGrade,
        indicativeTotalFcfa,
        discountPercent: pricingSummary.discountPercent,
        computedTotalFcfa: pricingSummary.totals.totalFcfa || 0,
        invoiceAmountOverrideFcfa,
        totalFcfa: effectiveInvoiceTotalFcfa || 0,
        billingAdjustmentReason,
        paymentServiceFeeFcfa: paymentPricing.paymentServiceFeeFcfa,
        amountToPayFcfa: paymentPricing.amountToPayFcfa,
        messageId: notificationResult.messageId || null,
        messagePurpose,
        messageStatus: finalMessageStatus,
        notificationChannel: notificationResult.channel || null,
        notificationAttempts: notificationResult.attempts || [],
        actorName,
        paymentLink,
        waveSessionId: null,
      },
      actorAdminId,
    });

    return nextPreorder;
  });

  const finalResult = {
    preorder: updatedPreorder,
    billingMessage: notificationResult.messageId
      ? await prisma.orderMessage.findUnique({
          where: { id: notificationResult.messageId },
        })
      : null,
    whatsappStatus: finalMessageStatus,
    whatsappTo,
    paymentLinkTarget: paymentLink,
    trackedPaymentLink: paymentLink,
    paymentRef: null,
    paymentPricing,
    notificationChannel: notificationResult.channel || null,
    notificationAttempts: notificationResult.attempts || [],
  };

  return finalResult;
}

module.exports = {
  invoiceAndSendPreorder,
  generateInvoiceRef,
  buildInvoiceMessage,
  buildInvoicePreview,
  computePaymentPricing,
  normalizeInvoiceAmountOverride,
};
