// backend/src/services/whatsapp.service.js

const { normalizeInternationalPhone } = require("../utils/phone");

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
 * (aucune API pour ça). Texte exact de chaque modèle et ordre des variables :
 * docs/whatsapp-templates.md (source de vérité, à garder en phase).
 * Tant que MAILERSEND_WHATSAPP_API_KEY/_SENDER ne sont pas configurés, on
 * retombe sur sendTextMessage() (simulé). Une fois configurés, un modèle
 * manquant est un échec explicite (jamais un faux "envoyé").
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

// Un modèle approuvé par clé (numéros = docs/whatsapp-templates.md). La
// billetterie (modèles 14-15) reste en SMS seul tant que le consentement des
// acheteurs n'est pas recueilli.
const WHATSAPP_TEMPLATE_ENV_BY_KEY = {
  INVOICE_WAVE: "MAILERSEND_WHATSAPP_TEMPLATE_INVOICE_WAVE",
  INVOICE_CASH: "MAILERSEND_WHATSAPP_TEMPLATE_INVOICE_CASH",
  INVOICE_BANK: "MAILERSEND_WHATSAPP_TEMPLATE_INVOICE_BANK",
  REMINDER_WAVE: "MAILERSEND_WHATSAPP_TEMPLATE_REMINDER_WAVE",
  REMINDER_CASH: "MAILERSEND_WHATSAPP_TEMPLATE_REMINDER_CASH",
  REMINDER_BANK: "MAILERSEND_WHATSAPP_TEMPLATE_REMINDER_BANK",
  PAYMENT_CONFIRMED: "MAILERSEND_WHATSAPP_TEMPLATE_PAYMENT_CONFIRMED",
  PREPARATION_STARTED: "MAILERSEND_WHATSAPP_TEMPLATE_PREPARATION_STARTED",
  ORDER_READY_PICKUP: "MAILERSEND_WHATSAPP_TEMPLATE_ORDER_READY_PICKUP",
  ORDER_READY_SHIPPING: "MAILERSEND_WHATSAPP_TEMPLATE_ORDER_READY_SHIPPING",
  SHIPPING_PAYMENT: "MAILERSEND_WHATSAPP_TEMPLATE_SHIPPING_PAYMENT",
  ORDER_FULFILLED_PICKUP: "MAILERSEND_WHATSAPP_TEMPLATE_ORDER_FULFILLED_PICKUP",
  ORDER_FULFILLED_SHIPPING: "MAILERSEND_WHATSAPP_TEMPLATE_ORDER_FULFILLED_SHIPPING",
};

const BANK_PAYMENT_FLOWS = new Set(["BANK_TRANSFER", "ECOBANK_PAY", "PI_SPI"]);

const BANK_PAYMENT_FLOW_LABELS = {
  BANK_TRANSFER: "Virement bancaire",
  ECOBANK_PAY: "Ecobank Pay",
  PI_SPI: "PI SPI",
};

// Ville de retrait par défaut quand l'adresse n'est pas renseignée dans les
// réglages du pays.
const PICKUP_CITY_BY_COUNTRY = {
  CIV: "ABIDJAN",
  BFA: "OUAGADOUGOU",
  BEN: "COTONOU",
  NER: "NIAMEY",
  TGO: "LOME",
};

function getWhatsAppTemplateId(templateKey) {
  const envName = WHATSAPP_TEMPLATE_ENV_BY_KEY[String(templateKey || "").toUpperCase()];
  if (!envName) return null;
  return String(process.env[envName] || "").trim() || null;
}

function isShippingContext(context = {}) {
  return require("./shipping.service").isShipping(context.preorder?.deliveryMode);
}

// Suffixe du modèle de paiement : le lien (et donc le bouton) décide du texte.
// Sans lien, le FBO règle au comptoir avec son code, quel que soit le mode.
function resolvePaymentTemplateSuffix(context = {}) {
  if (!context.paymentLink) return "CASH";
  const flow = String(context.paymentFlow || "").toUpperCase();
  if (BANK_PAYMENT_FLOWS.has(flow)) return "BANK";
  return "WAVE";
}

/**
 * Choisit le modèle WhatsApp à partir du purpose brut (avant mapping vers
 * l'enum OrderMessagePurpose) et du contexte. null = aucun modèle prévu
 * (ex. PREORDER_SUBMITTED, AUTO_CANCEL) : mieux vaut ne rien envoyer sur
 * WhatsApp qu'un modèle au texte inadapté.
 */
function resolveWhatsAppTemplateKey(purpose, context = {}) {
  const key = String(purpose || "").trim().toUpperCase();

  if (key === "INVOICE" || key === "PAYMENT_LINK") {
    return `INVOICE_${resolvePaymentTemplateSuffix(context)}`;
  }
  if (key === "REMINDER") return `REMINDER_${resolvePaymentTemplateSuffix(context)}`;
  if (key === "PAYMENT_CONFIRMED" || key === "PREPARATION_STARTED") return key;
  if (key === "ORDER_READY" || key === "ORDER_FULFILLED") {
    return `${key}_${isShippingContext(context) ? "SHIPPING" : "PICKUP"}`;
  }
  if (key === "SHIPPING_PAYMENT_LINK") return "SHIPPING_PAYMENT";
  return null;
}

// Contraintes Meta sur une valeur de variable : jamais vide, pas de retour à
// la ligne ni de tabulation, pas plus de 4 espaces consécutifs.
function sanitizeTemplateValue(value, fallback = "-") {
  const clean = String(value ?? "")
    .replace(/\s*[\r\n]+\s*/g, ", ")
    .replace(/\t/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  return clean || fallback;
}

// Fin d'URL à injecter dans un bouton URL dynamique dont la partie fixe est
// "{BASE}/<segment>/" (ex. "/payment/" couvre /payment/w/<jeton> comme
// /payment/wave/<id>?country=CIV). null si le lien ne contient pas le segment.
function extractButtonSuffix(link, segment) {
  try {
    const url = new URL(String(link || ""));
    const marker = `/${segment}/`;
    const index = url.pathname.indexOf(marker);
    if (index < 0) return null;
    const suffix = `${url.pathname.slice(index + marker.length)}${url.search}`;
    return suffix || null;
  } catch {
    return null;
  }
}

function resolvePickupLocation(context = {}, countryCode = "CIV") {
  const code = String(countryCode || "CIV").toUpperCase();
  return sanitizeTemplateValue(context.pickupAddress, PICKUP_CITY_BY_COUNTRY[code] || "-");
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
  // de n'importe quel pays, contrairement à normalizePhone() (digits seuls, pensé pour les liens
  // wa.me) utilisé ailleurs dans ce fichier.
  const normalizedTo = normalizeInternationalPhone(to, countryCode);

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
 * Construit les variables positionnelles d'un modèle (clé issue de
 * resolveWhatsAppTemplateKey), à partir du même `context` que SMS/email
 * (preorder-notifications.service.js#buildTemplateContext). L'ordre doit
 * rester celui de docs/whatsapp-templates.md : MailerSend rejette (422) tout
 * écart de nombre de variables avec le modèle approuvé.
 * Renvoie { body, buttons } ou { errorCode, errorMessage } si un bouton
 * attendu n'a pas de lien exploitable.
 */
function buildPreorderTemplateVariables(templateKey, context = {}, { countryCode = "CIV" } = {}) {
  const key = String(templateKey || "").toUpperCase();
  const v = (value) => sanitizeTemplateValue(value);
  const customerName = v(context.customerName || "Client");
  const preorderNumber = v(context.preorderNumber);
  const parcelNumber = v(context.parcelNumber);
  const collectionCode = v(context.paymentCollectionCode);
  const total = v(context.totalFcfaLabel);
  const expiryHours = v(context.paymentExpiryHours);
  const preorder = context.preorder || {};
  const carrier = v(require("./shipping.service").carrierLabel(preorder.deliveryMode));

  const withButton = (body, link, segment) => {
    const suffix = extractButtonSuffix(link, segment);
    if (!suffix) {
      return {
        errorCode: "WHATSAPP_BUTTON_LINK_INVALID",
        errorMessage: `Lien inexploitable pour le bouton WhatsApp (segment /${segment}/ attendu).`,
      };
    }
    return { body, buttons: [suffix] };
  };

  const paymentHead = [customerName, preorderNumber, collectionCode, total];
  const bankModeLabel = v(BANK_PAYMENT_FLOW_LABELS[String(context.paymentFlow || "").toUpperCase()]);

  switch (key) {
    case "INVOICE_WAVE":
      return withButton([...paymentHead, expiryHours], context.paymentLink, "payment");
    case "INVOICE_CASH":
      return { body: [...paymentHead, expiryHours] };
    case "INVOICE_BANK":
      return withButton(
        [
          ...paymentHead,
          bankModeLabel,
          sanitizeTemplateValue(context.bankAccountDetails, "affiché sur la page de dépôt de preuve"),
          expiryHours,
        ],
        context.paymentLink,
        "payment",
      );
    case "REMINDER_WAVE":
      return withButton(paymentHead, context.paymentLink, "payment");
    case "REMINDER_CASH":
      return { body: paymentHead };
    case "REMINDER_BANK":
      return withButton([...paymentHead, bankModeLabel], context.paymentLink, "payment");
    case "PAYMENT_CONFIRMED":
      return { body: [customerName, preorderNumber, total] };
    case "PREPARATION_STARTED":
      return { body: [customerName, parcelNumber] };
    case "ORDER_READY_PICKUP":
      return {
        body: [customerName, parcelNumber, v(context.pickupCode), resolvePickupLocation(context, countryCode)],
      };
    case "ORDER_READY_SHIPPING":
      return { body: [customerName, parcelNumber, carrier] };
    case "SHIPPING_PAYMENT": {
      const link = preorder.shippingPaymentLink || {};
      return withButton(
        [
          customerName,
          carrier,
          preorderNumber,
          formatFcfa(link.baseAmountFcfa),
          formatFcfa(link.serviceFeeFcfa),
          formatFcfa(link.amountFcfa),
        ],
        context.paymentLink,
        "external-payment",
      );
    }
    case "ORDER_FULFILLED_PICKUP":
      return { body: [customerName, parcelNumber, preorderNumber] };
    case "ORDER_FULFILLED_SHIPPING":
      return {
        body: [customerName, parcelNumber, carrier, sanitizeTemplateValue(preorder.deliveryTracking, "non renseigné")],
      };
    default:
      return {
        errorCode: "MAILERSEND_WHATSAPP_TEMPLATE_MISSING",
        errorMessage: "Aucun modèle WhatsApp prévu pour ce type de message.",
      };
  }
}

// Interrupteur d'urgence : WhatsApp est le canal principal des FBO dès que
// MailerSend et le modèle sont configurés, sauf WHATSAPP_PRIMARY_ENABLED=false.
function isWhatsAppPrimaryEnabled() {
  return String(process.env.WHATSAPP_PRIMARY_ENABLED ?? "true").trim().toLowerCase() !== "false";
}

/**
 * Vrai si ce message peut réellement partir en WhatsApp : MailerSend
 * configuré, modèle approuvé renseigné pour ce cas, variables constructibles.
 * Sert à choisir WhatsApp en canal principal (SMS en secours) sans jamais
 * l'essayer quand l'échec est certain.
 */
function canSendPreorderWhatsAppTemplate(purpose, context = {}, { countryCode = "CIV" } = {}) {
  if (!isWhatsAppPrimaryEnabled() || !mailerSendWhatsAppConfigured()) return false;
  const templateKey = resolveWhatsAppTemplateKey(purpose, context);
  if (!templateKey || !getWhatsAppTemplateId(templateKey)) return false;
  return !buildPreorderTemplateVariables(templateKey, context, { countryCode }).errorCode;
}

function whatsappFailure(errorCode, errorMessage, metadata = {}) {
  return {
    accepted: false,
    provider: "MAILERSEND_WHATSAPP",
    providerMessageId: null,
    rawPayload: { metadata },
    errorCode,
    errorMessage,
  };
}

/**
 * Point d'entrée utilisé par preorder-notifications.service.js pour le canal
 * WHATSAPP. `purpose` est le purpose brut (ex. SHIPPING_PAYMENT_LINK), pas sa
 * version enum. Sans configuration MailerSend, on reste en mode simulé
 * (sendTextMessage) avec le texte SMS déjà préparé par l'appelant ; avec, un
 * modèle absent ou non configuré est un échec explicite, pour que l'historique
 * ne montre jamais "envoyé" alors que rien n'est parti.
 */
async function sendPreorderWhatsAppNotification({
  to,
  purpose,
  context = {},
  fallbackMessage = "",
  metadata = {},
  countryCode = "CIV",
}) {
  if (!mailerSendWhatsAppConfigured()) {
    return sendTextMessage({ to, body: fallbackMessage, metadata });
  }

  const templateKey = resolveWhatsAppTemplateKey(purpose, context);
  const templateId = getWhatsAppTemplateId(templateKey);
  if (!templateKey || !templateId) {
    return whatsappFailure(
      "MAILERSEND_WHATSAPP_TEMPLATE_MISSING",
      templateKey
        ? `Modèle WhatsApp ${templateKey} non configuré (${WHATSAPP_TEMPLATE_ENV_BY_KEY[templateKey]}).`
        : `Aucun modèle WhatsApp prévu pour ${String(purpose || "-").toUpperCase()}.`,
      { ...metadata, templateKey },
    );
  }

  const variables = buildPreorderTemplateVariables(templateKey, context, { countryCode });
  if (variables.errorCode) {
    return whatsappFailure(variables.errorCode, variables.errorMessage, { ...metadata, templateKey });
  }

  return sendMailerSendWhatsAppTemplate({
    to,
    templateId,
    header: variables.header || [],
    body: variables.body || [],
    buttons: variables.buttons || [],
    metadata: { ...metadata, templateKey },
    countryCode,
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
  mapProviderStatus,
  mailerSendWhatsAppConfigured,
  getWhatsAppTemplateId,
  resolveWhatsAppTemplateKey,
  isWhatsAppPrimaryEnabled,
  canSendPreorderWhatsAppTemplate,
  sanitizeTemplateValue,
  extractButtonSuffix,
  sendMailerSendWhatsAppTemplate,
  buildPreorderTemplateVariables,
  sendPreorderWhatsAppNotification,
};
