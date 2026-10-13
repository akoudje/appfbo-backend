// backend/src/services/whatsapp.service.js

/**
 * Formate un montant FCFA
 */
function formatFcfa(value) {
  const n = Number(value || 0);
  const safe = Number.isFinite(n) ? n : 0;
  const display = safe > 0 && safe % 1 !== 0 ? Math.ceil(safe) : Math.round(safe);
  return `${new Intl.NumberFormat("fr-FR").format(display)} FCFA`;
}

/**
 * Nettoie un numéro de téléphone pour wa.me ou provider
 */
function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

/**
 * Rend un enum plus lisible
 */
function humanizeEnum(value) {
  if (!value) return "-";

  return String(value)
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * Construit l'en-tête de la précommande
 */
function formatPreorderHeader(preorder) {
  const countryCode = preorder?.country?.code || "CIV";
  return `- PRÉCOMMANDE FLP ${countryCode} -`;
}

/**
 * Construit un message récapitulatif complet de précommande
 * Usage: génération manuelle / audit / support
 */
function buildPreorderWhatsAppMessage({ preorder, items = [], totals = {} }) {
  const lines = [];

  lines.push(formatPreorderHeader(preorder));
  lines.push(`Précommande N° : ${preorder?.preorderNumber || "-"}`);
  lines.push(`FBO : ${preorder?.fboNumero || "-"}`);
  lines.push(`Nom : ${preorder?.fboNomComplet || "-"}`);
  lines.push(`Mode de livraison : ${humanizeEnum(preorder?.deliveryMode)}`);
  lines.push(
    `Mode de paiement : ${humanizeEnum(preorder?.preorderPaymentMode)}`
  );
  lines.push("");

  lines.push(`Produits demandés :`);
  for (const it of items) {
    lines.push(
      `- x ${it.qty || 0} | SKU: ${it.sku || it.productSkuSnapshot || "-"} | ${it.nom || it.productNameSnapshot || "-"} | ${formatFcfa(it.lineTotalFcfa)} | ${it.lineTotalCc || 0} CC`
    );
  }

  lines.push("");
  lines.push(`Totaux :`);
  lines.push(`Produits : ${formatFcfa(totals.totalProduitsFcfa)}`);
  lines.push(`Livraison : ${formatFcfa(totals.fraisLivraisonFcfa)}`);
  lines.push(`Emballage : ${formatFcfa(totals.emballageFcfa)}`);
  lines.push(`TOTAL : ${formatFcfa(totals.totalFcfa)}`);

  return lines.join("\n");
}

/**
 * Alias rétrocompatible
 * Permet à l'ancien code d'utiliser encore buildWhatsAppMessage
 */
function buildWhatsAppMessage(args) {
  return buildPreorderWhatsAppMessage(args);
}

/**
 * Construit un lien wa.me pour envoi manuel depuis WhatsApp
 */
function buildWhatsAppLink(phone, message) {
  const clean = normalizePhone(phone);
  const encoded = encodeURIComponent(message || "");
  return `https://wa.me/${clean}?text=${encoded}`;
}

/**
 * Message de facturation / paiement envoyé au FBO
 * Harmonisé avec le workflow invoiceAndSendPreorder
 */
function buildPaymentWhatsAppMessage({
  fboNomComplet,
  fboNumero,
  factureReference,
  totalFcfa,
  paymentLink,
  paymentMode,
  note,
}) {
  const normalizedMode = String(paymentMode || "").trim().toUpperCase();

  const lines = [
    `Bonjour ${fboNomComplet || "Cher FBO"},`,
    "",
    "Votre précommande FOREVER a bien été enregistrée et votre préfacture est prête.",
    "",
    `Numéro FBO : ${fboNumero || "-"}`,
    `Montant à payer : ${formatFcfa(totalFcfa)}`,
  ];

  if (normalizedMode === "ESPECES") {
    lines.push("");
    lines.push(
      "Merci de vous présenter au bureau pour effectuer le règlement en espèces."
    );
    lines.push("Votre commande sera préparée après validation du paiement.");
  } else if (normalizedMode === "BANK_TRANSFER" || normalizedMode === "ECOBANK_PAY" || normalizedMode === "PI_SPI") {
    lines.push("");
    lines.push(
      normalizedMode === "PI_SPI"
        ? "Merci d'effectuer votre paiement PI SPI selon les instructions reçues."
        : normalizedMode === "ECOBANK_PAY"
          ? "Merci d'effectuer votre paiement Ecobank Pay selon les instructions reçues."
          : "Merci d'effectuer votre virement/versement bancaire selon les instructions reçues."
    );
    lines.push(
      "Déposez ensuite la preuve de paiement depuis votre espace client sécurisé."
    );
  } else if (paymentLink) {
    lines.push("");
    lines.push("Lien de paiement Wave :");
    lines.push(paymentLink);
    lines.push("");
    lines.push("Veuillez cliquer sur ce lien pour finaliser votre paiement.");
    lines.push("Une fois le paiement confirmé, votre commande sera préparée.");
  } else {
    lines.push("");
    lines.push(
      "Merci de procéder au règlement selon les instructions communiquées."
    );
  }

  if (note) {
    lines.push("");
    lines.push(String(note));
  }

  lines.push("");
  lines.push("Merci.");
  lines.push("FOREVER");

  return lines.join("\n");
}

/**
 * Alias plus explicite pour le workflow de facturation
 */
function buildInvoiceWhatsAppMessage({
  customerName,
  fboNumero,
  invoiceRef,
  totalFcfa,
  paymentLink,
  paymentMode,
  note,
}) {
  return buildPaymentWhatsAppMessage({
    fboNomComplet: customerName,
    fboNumero,
    factureReference: invoiceRef,
    totalFcfa,
    paymentLink,
    paymentMode,
    note,
  });
}

/**
 * Config Meta WhatsApp Cloud API. Tant que WHATSAPP_API_TOKEN /
 * WHATSAPP_PHONE_NUMBER_ID ne sont pas renseignés, sendPaymentLinkTemplate
 * retombe en mode simulé (comme sendTextMessage) au lieu d'échouer : ça
 * permet de merger/déployer ce code avant même que le template soit validé
 * par Meta et que les identifiants soient disponibles en prod.
 */
function getWhatsAppCloudApiConfig() {
  return {
    token: String(process.env.WHATSAPP_API_TOKEN || "").trim(),
    phoneNumberId: String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim(),
    apiVersion: String(process.env.WHATSAPP_API_VERSION || "v21.0").trim(),
  };
}

function whatsappCloudApiConfigured() {
  const cfg = getWhatsAppCloudApiConfig();
  return Boolean(cfg.token && cfg.phoneNumberId);
}

/**
 * Envoie un message WhatsApp "template" (seul format autorisé par Meta pour
 * un message à l'initiative de l'entreprise, hors fenêtre de session 24h —
 * voir https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates).
 * Le texte libre (sendTextMessage) ne peut PAS être utilisé pour ces envois.
 */
async function sendTemplateMessage({ to, templateName, languageCode, bodyParams = [] }) {
  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) {
    return {
      accepted: false,
      provider: "WHATSAPP",
      providerMessageId: null,
      rawPayload: null,
      errorCode: "NO_DESTINATION",
      errorMessage: "Numéro WhatsApp manquant ou invalide.",
    };
  }

  const cfg = getWhatsAppCloudApiConfig();
  if (!cfg.token || !cfg.phoneNumberId) {
    console.log("[whatsapp.sendTemplateMessage][simulated: identifiants Meta absents]", {
      to: normalizedTo,
      templateName,
      languageCode,
      bodyParams,
    });
    return {
      accepted: true,
      provider: "WHATSAPP_SIMULATED",
      providerMessageId: `sim_${Date.now()}`,
      rawPayload: { simulated: true, to: normalizedTo, templateName, languageCode, bodyParams },
      errorCode: null,
      errorMessage: null,
    };
  }

  const payload = {
    messaging_product: "whatsapp",
    to: normalizedTo,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(bodyParams.length
        ? { components: [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text: String(text) })) }] }
        : {}),
    },
  };

  try {
    const response = await fetch(
      `https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    const responseText = await response.text();
    let responseJson = null;
    try {
      responseJson = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseJson = null;
    }

    if (!response.ok) {
      return {
        accepted: false,
        provider: "WHATSAPP",
        providerMessageId: null,
        rawPayload: { status: response.status, body: responseJson || responseText || null },
        errorCode: responseJson?.error?.code
          ? `WHATSAPP_${responseJson.error.code}`
          : `WHATSAPP_${response.status}`,
        errorMessage: responseJson?.error?.message || responseText || "Échec d'envoi WhatsApp.",
      };
    }

    return {
      accepted: true,
      provider: "WHATSAPP",
      providerMessageId: responseJson?.messages?.[0]?.id || null,
      rawPayload: { status: response.status, body: responseJson },
      errorCode: null,
      errorMessage: null,
    };
  } catch (error) {
    return {
      accepted: false,
      provider: "WHATSAPP",
      providerMessageId: null,
      rawPayload: { name: error?.name || null, message: error?.message || null },
      errorCode: error?.code || "WHATSAPP_SEND_FAILED",
      errorMessage: error?.message || "Échec d'envoi WhatsApp.",
    };
  }
}

/**
 * Premier template WhatsApp mis en production : le lien de paiement de
 * précommande (purpose INVOICE/PAYMENT_LINK). Le nom/la langue du template
 * sont configurables par env car la valeur réelle dépend du nom exact validé
 * dans le WhatsApp Manager de Meta — voir le fichier modèle fourni avec ce
 * correctif pour le contenu exact soumis à validation.
 */
async function sendPaymentLinkTemplate({ to, customerName, preorderNumber, amountLabel, paymentLink }) {
  const templateName = String(
    process.env.WHATSAPP_TEMPLATE_PAYMENT_LINK_NAME || "payment_link_notification",
  ).trim();
  const languageCode = String(process.env.WHATSAPP_TEMPLATE_PAYMENT_LINK_LANG || "fr").trim();

  return sendTemplateMessage({
    to,
    templateName,
    languageCode,
    bodyParams: [
      customerName || "Client",
      preorderNumber || "-",
      amountLabel || "-",
      paymentLink || "",
    ],
  });
}

/**
 * Envoi texte WhatsApp
 * Pour l’instant: mode simulé
 * Plus tard: remplacer par Meta Cloud API / Twilio / autre provider
 */
async function sendTextMessage({ to, body, metadata = {} }) {
  const normalizedTo = normalizePhone(to);

  if (!normalizedTo) {
    return {
      accepted: false,
      provider: "SIMULATED",
      providerMessageId: null,
      rawPayload: {
        ok: false,
        reason: "NO_DESTINATION",
        metadata,
      },
      errorCode: "NO_DESTINATION",
      errorMessage: "Numéro WhatsApp manquant ou invalide.",
    };
  }

  console.log("[whatsapp.sendTextMessage]", {
    to: normalizedTo,
    body,
    metadata,
  });

  return {
    accepted: true,
    provider: "SIMULATED",
    providerMessageId: `sim_${Date.now()}`,
    rawPayload: {
      ok: true,
      simulated: true,
      to: normalizedTo,
      metadata,
    },
  };
}

/**
 * Mappe un statut provider vers ton statut interne Prisma
 */
function mapProviderStatus(input) {
  const s = String(input || "").toLowerCase();

  if (s === "draft") return "DRAFT";
  if (s === "queued") return "QUEUED";
  if (s === "sent") return "SENT";
  if (s === "delivered") return "DELIVERED";
  if (s === "read") return "READ";
  if (s === "failed") return "FAILED";
  if (s === "cancelled" || s === "canceled") return "CANCELLED";

  return "SENT";
}

module.exports = {
  formatFcfa,
  normalizePhone,
  buildPreorderWhatsAppMessage,
  buildWhatsAppMessage,
  buildWhatsAppLink,
  buildPaymentWhatsAppMessage,
  buildInvoiceWhatsAppMessage,
  sendTextMessage,
  sendTemplateMessage,
  sendPaymentLinkTemplate,
  whatsappCloudApiConfigured,
  mapProviderStatus,
};
