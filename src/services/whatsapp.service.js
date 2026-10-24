// backend/src/services/whatsapp.service.js

const { normalizeForCountry } = require("../utils/phone");

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
 * Intégration réelle MailerSend WhatsApp.
 * https://developers.mailersend.com/api/v1/whatsapp
 *
 * Contrainte Meta/WhatsApp: un message initié par l'entreprise doit utiliser
 * un modèle ("template") pré-approuvé par Meta (texte fixe + variables
 * positionnelles {{1}}, {{2}}...) — impossible d'envoyer du texte libre comme
 * pour SMS/email. Chaque "purpose" ci-dessous correspond donc à un modèle à
 * créer et faire approuver manuellement dans le dashboard MailerSend
 * (aucune API pour ça). Tant que MAILERSEND_WHATSAPP_API_KEY/_SENDER ou le
 * template d'un purpose donné ne sont pas configurés, on retombe sur
 * sendTextMessage() (simulé) pour ne rien casser.
 */

function getMailerSendWhatsAppConfig() {
  const apiKey = String(
    process.env.MAILERSEND_WHATSAPP_API_KEY || process.env.MAILERSEND_API_KEY || "",
  ).trim();
  const apiUrl = String(
    process.env.MAILERSEND_WHATSAPP_API_URL || "https://api.mailersend.com/v1/whatsapp/send",
  ).trim();
  const sender = String(process.env.MAILERSEND_WHATSAPP_SENDER || "").trim();

  return { apiKey, apiUrl, sender };
}

function mailerSendWhatsAppConfigured() {
  const cfg = getMailerSendWhatsAppConfig();
  return Boolean(cfg.apiKey && cfg.sender);
}

// Un modèle approuvé par purpose (variables http://developers.mailersend.com/api/v1/whatsapp#template-variables).
// Clés alignées sur OrderMessagePurpose (PAYMENT_LINK -> même modèle qu'INVOICE)
// + 2 purposes dédiés au rappel billet (hors OrderMessage, cf ticket-sms-reminder.service.js).
const WHATSAPP_TEMPLATE_ENV_BY_PURPOSE = {
  INVOICE: "MAILERSEND_WHATSAPP_TEMPLATE_INVOICE",
  PAYMENT_LINK: "MAILERSEND_WHATSAPP_TEMPLATE_INVOICE",
  REMINDER: "MAILERSEND_WHATSAPP_TEMPLATE_REMINDER",
  PAYMENT_CONFIRMED: "MAILERSEND_WHATSAPP_TEMPLATE_PAYMENT_CONFIRMED",
  PREPARATION_STARTED: "MAILERSEND_WHATSAPP_TEMPLATE_PREPARATION_STARTED",
  ORDER_READY: "MAILERSEND_WHATSAPP_TEMPLATE_ORDER_READY",
  ORDER_FULFILLED: "MAILERSEND_WHATSAPP_TEMPLATE_ORDER_FULFILLED",
  TICKET_REMINDER: "MAILERSEND_WHATSAPP_TEMPLATE_TICKET_REMINDER",
  TICKET_PORTAL_HINT: "MAILERSEND_WHATSAPP_TEMPLATE_TICKET_PORTAL_HINT",
};

function getWhatsAppTemplateId(purposeKey) {
  const envName = WHATSAPP_TEMPLATE_ENV_BY_PURPOSE[String(purposeKey || "").toUpperCase()];
  if (!envName) return null;
  return String(process.env[envName] || "").trim() || null;
}

/**
 * Appel direct de l'API MailerSend (POST /v1/whatsapp/send).
 * header/body/buttons: tableaux positionnels (voir doc) pour un seul
 * destinataire — on envoie toujours un message par destinataire ici, jamais
 * les envois groupés (max 10) permis par l'API, pour rester simple à tracer
 * dans OrderMessage (1 ligne = 1 destinataire).
 */
async function sendMailerSendWhatsAppTemplate({
  to,
  templateId,
  header = [],
  body = [],
  buttons = [],
  metadata = {},
  countryCode = "CIV",
}) {
  const cfg = getMailerSendWhatsAppConfig();
  // L'API MailerSend attend un numéro E.164 avec "+" (ex: "+2250506025071"),
  // contrairement à normalizePhone() (digits seuls, pensé pour les liens
  // wa.me) utilisé ailleurs dans ce fichier.
  const normalizedTo = normalizeForCountry(to, countryCode);

  if (!cfg.apiKey || !cfg.sender) {
    return {
      accepted: false,
      provider: "MAILERSEND_WHATSAPP",
      providerMessageId: null,
      rawPayload: null,
      errorCode: "MAILERSEND_WHATSAPP_NOT_CONFIGURED",
      errorMessage: "MAILERSEND_WHATSAPP_API_KEY et MAILERSEND_WHATSAPP_SENDER sont requis.",
    };
  }
  if (!normalizedTo) {
    return {
      accepted: false,
      provider: "MAILERSEND_WHATSAPP",
      providerMessageId: null,
      rawPayload: null,
      errorCode: "NO_DESTINATION",
      errorMessage: "Numéro WhatsApp manquant ou invalide.",
    };
  }
  if (!templateId) {
    return {
      accepted: false,
      provider: "MAILERSEND_WHATSAPP",
      providerMessageId: null,
      rawPayload: null,
      errorCode: "MAILERSEND_WHATSAPP_TEMPLATE_MISSING",
      errorMessage: "Aucun modèle WhatsApp approuvé configuré pour ce type de message.",
    };
  }

  try {
    const payload = {
      from: cfg.sender,
      to: [normalizedTo],
      template_id: templateId,
      personalization: [
        {
          to: normalizedTo,
          data: {
            ...(header.length ? { header } : {}),
            ...(body.length ? { body } : {}),
            ...(buttons.length ? { buttons } : {}),
          },
        },
      ],
    };

    const response = await fetch(cfg.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const responseText = await response.text();
    let responseJson = null;
    try {
      responseJson = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseJson = null;
    }
    const providerMessageId =
      response.headers.get("x-message-id") || responseJson?.data?.id || null;

    if (!response.ok) {
      return {
        accepted: false,
        provider: "MAILERSEND_WHATSAPP",
        providerMessageId,
        rawPayload: { status: response.status, body: responseJson || responseText || null, metadata },
        errorCode: `MAILERSEND_WHATSAPP_${response.status}`,
        errorMessage:
          responseJson?.message ||
          (responseJson?.errors ? JSON.stringify(responseJson.errors) : null) ||
          responseText ||
          "Échec d'envoi WhatsApp MailerSend.",
      };
    }

    return {
      accepted: true,
      provider: "MAILERSEND_WHATSAPP",
      providerMessageId,
      rawPayload: { status: response.status, body: responseJson || null, metadata },
      errorCode: null,
      errorMessage: null,
    };
  } catch (error) {
    return {
      accepted: false,
      provider: "MAILERSEND_WHATSAPP",
      providerMessageId: null,
      rawPayload: { name: error?.name || null, cause: error?.cause?.message || null, metadata },
      errorCode: error?.code || "MAILERSEND_WHATSAPP_SEND_FAILED",
      errorMessage: error?.message || "Échec d'envoi WhatsApp MailerSend.",
    };
  }
}

/**
 * Construit les variables positionnelles pour un purpose de précommande, à
 * partir du même `context` déjà construit pour SMS/email
 * (preorder-notifications.service.js#buildTemplateContext). Doit rester en
 * phase avec le texte réellement soumis à Meta pour chaque modèle — voir
 * commentaire en tête de section pour la correspondance attendue.
 */
function buildPreorderTemplateVariables(purposeKey, context = {}) {
  const key = String(purposeKey || "").toUpperCase();
  const customerName = context.customerName || "Client";
  const paymentInstructionLine = context.paymentLink
    ? `Lien de paiement sécurisé : ${context.paymentLink}`
    : "Présentez ce code au comptoir pour régler.";

  if (key === "INVOICE" || key === "PAYMENT_LINK") {
    return {
      body: [customerName, context.paymentCollectionCode || "-", context.totalFcfaLabel || "-", paymentInstructionLine],
    };
  }
  if (key === "REMINDER") {
    return {
      body: [customerName, context.paymentCollectionCode || "-", context.totalFcfaLabel || "-", paymentInstructionLine],
    };
  }
  if (key === "PAYMENT_CONFIRMED") {
    return {
      body: [customerName, context.preorderNumber || "-", context.totalFcfaLabel || "-"],
    };
  }
  if (key === "PREPARATION_STARTED") {
    return {
      body: [customerName, context.parcelNumber || "-"],
    };
  }
  if (key === "ORDER_READY") {
    return {
      body: [customerName, context.parcelNumber || "-", context.pickupCode || "-"],
    };
  }
  if (key === "ORDER_FULFILLED") {
    return {
      body: [customerName, context.preorderNumber || "-", context.parcelNumber || "-"],
    };
  }
  return { body: [customerName] };
}

/**
 * Point d'entrée utilisé par preorder-notifications.service.js pour le canal
 * WHATSAPP. Essaie l'envoi réel MailerSend si configuré pour ce purpose,
 * sinon retombe sur le mode simulé existant (sendTextMessage) avec le texte
 * SMS/WhatsApp déjà préparé par l'appelant, pour ne jamais régresser avant la
 * fin de la configuration MailerSend (add-on, WABA, modèles approuvés).
 */
async function sendPreorderWhatsAppNotification({
  to,
  purpose,
  context = {},
  fallbackMessage = "",
  metadata = {},
  countryCode = "CIV",
}) {
  const purposeKey = String(purpose || "").toUpperCase();
  const templateId = getWhatsAppTemplateId(purposeKey);

  if (mailerSendWhatsAppConfigured() && templateId) {
    const variables = buildPreorderTemplateVariables(purposeKey, context);
    return sendMailerSendWhatsAppTemplate({
      to,
      templateId,
      header: variables.header || [],
      body: variables.body || [],
      buttons: variables.buttons || [],
      metadata,
      countryCode,
    });
  }

  return sendTextMessage({ to, body: fallbackMessage, metadata });
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
  mapProviderStatus,
  mailerSendWhatsAppConfigured,
  getWhatsAppTemplateId,
  sendMailerSendWhatsAppTemplate,
  buildPreorderTemplateVariables,
  sendPreorderWhatsAppNotification,
};
