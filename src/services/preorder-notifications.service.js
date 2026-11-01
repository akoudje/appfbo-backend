const prisma = require("../prisma");
const { sendSms } = require("./sms.service");
const { normalizeForCountry } = require("../utils/phone");
const whatsappService = require("./whatsapp.service");
const { normalizeEmail, sendEmail } = require("./email.service");
const { MAX_SMS_LENGTH } = require("./sms.orange.service");
const { getPaymentExpiryHours } = require("./notification-template-defaults");
const { sendPreorderMobilePush } = require("./mobile-push.service");
const { renderLayout, renderButton, textToHtml } = require("./email-templates/layout");

function compactText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function resolveNotificationOrderRef(preorder = {}) {
  return compactText(
    preorder?.preorderNumber || preorder?.paymentCollectionCode || preorder?.id || "-",
  );
}

function buildNotificationPrefix(preorder = {}) {
  return `FOREVER: ${resolveNotificationOrderRef(preorder)}.`;
}

function prependNotificationPrefix(preorder = {}, message = "") {
  const normalized = compactText(message || "");
  const prefix = buildNotificationPrefix(preorder);
  if (!normalized) return prefix;

  let stripped = normalized.replace(/^FOREVER:\s*/i, "");
  const orderRef = resolveNotificationOrderRef(preorder);
  const escapedRef = orderRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  stripped = stripped.replace(new RegExp(`^${escapedRef}\\.?\\s*`, "i"), "");
  stripped = compactText(stripped);

  return compactText(`${prefix} ${stripped}`);
}

function firstSmsCandidate(candidates = [], maxLength = MAX_SMS_LENGTH) {
  for (const raw of candidates) {
    const candidate = compactText(raw);
    if (!candidate) continue;
    if (candidate.length <= maxLength) return candidate;
  }
  const fallback = compactText(candidates[0] || "");
  if (
    fallback.includes("http://") ||
    fallback.includes("https://") ||
    fallback.includes("www.") ||
    fallback.includes("forevercivstore.com")
  ) {
    return fallback;
  }
  return fallback.slice(0, maxLength);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getNotificationMaxSmsAttempts() {
  return Math.max(1, parsePositiveInt(process.env.NOTIFICATION_SMS_MAX_ATTEMPTS, 4));
}

function getNotificationRetryBaseSeconds() {
  return Math.max(15, parsePositiveInt(process.env.NOTIFICATION_SMS_RETRY_BASE_SECONDS, 30));
}

function buildRetryDelaySeconds(attemptNumber = 1) {
  const base = getNotificationRetryBaseSeconds();
  const multiplier = Math.max(0, Number(attemptNumber) - 1);
  return base * Math.pow(2, multiplier);
}

function buildNextAttemptAt(attemptNumber = 1, fromDate = new Date()) {
  const delaySeconds = buildRetryDelaySeconds(attemptNumber);
  return new Date(fromDate.getTime() + delaySeconds * 1000);
}

function resolveNotificationPhone(preorder) {
  return (
    preorder?.factureWhatsappTo ||
    preorder?.messages?.find((message) => message?.toPhone)?.toPhone ||
    null
  );
}

async function resolvePreorderCountryCode(preorder) {
  const known = preorder?.country?.code || preorder?.countryCode;
  if (known) return known;
  if (!preorder?.countryId) return "CIV";
  const country = await prisma.country.findUnique({
    where: { id: preorder.countryId },
    select: { code: true },
  });
  return country?.code || "CIV";
}

function resolveNotificationEmail(preorder, explicitEmail = null) {
  if (explicitEmail && normalizeEmail(explicitEmail)) {
    return normalizeEmail(explicitEmail);
  }
  if (normalizeEmail(preorder?.fboEmail)) return normalizeEmail(preorder?.fboEmail);
  if (normalizeEmail(preorder?.fbo?.email)) return normalizeEmail(preorder?.fbo?.email);
  return null;
}

function buildPreparationStartedSmsMessage({ preorder }) {
  const customer = preorder?.fboNomComplet || "";
  const parcelNumber =
    preorder?.parcelNumber || preorder?.preorderNumber || preorder?.id || "-";

  return prependNotificationPrefix(
    preorder,
    firstSmsCandidate([
      `Bonjour ${customer}, votre colis ${parcelNumber} est en préparation. Vous serez notifié dès qu'il sera prêt.`,
      `Bonjour ${customer}, colis ${parcelNumber} en préparation.`,
      `Colis ${parcelNumber} en préparation.`,
    ]),
  );
}

function buildOrderReadySmsMessage({ preorder, pickupSecretCode }) {
  if (require("./shipping.service").isShipping(preorder?.deliveryMode)) return prependNotificationPrefix(preorder, preorder.shippingFeeFcfa === 0 ? `Colis ${preorder.parcelNumber || preorder.preorderNumber} prêt pour expédition. Expédition offerte.` : `Colis ${preorder.parcelNumber || preorder.preorderNumber} prêt. Retrouvez les frais d’expédition et leur paiement dans votre espace client.`);
  const customer = preorder?.fboNomComplet || "";
  const parcelNumber =
    preorder?.parcelNumber || preorder?.preorderNumber || preorder?.id || "-";

  return prependNotificationPrefix(
    preorder,
    firstSmsCandidate([
      `Bonjour ${customer}, votre colis ${parcelNumber} est prêt. Code retrait: ${pickupSecretCode}.`,
      `Bonjour ${customer}, colis ${parcelNumber} prêt. Code retrait: ${pickupSecretCode}.`,
      `Colis ${parcelNumber} prêt. Code: ${pickupSecretCode}.`,
    ]),
  );
}

function buildOrderFulfilledSmsMessage({ preorder }) {
  if (require("./shipping.service").isShipping(preorder?.deliveryMode)) {
    const carrier = require("./shipping.service").carrierLabel(preorder.deliveryMode);
    return firstSmsCandidate([
      prependNotificationPrefix(preorder, `Colis remis a ${carrier}. Bordereau: ${preorder.deliveryTracking || '-'}. Suivi dans votre espace client.`),
      prependNotificationPrefix(preorder, `Colis remis a ${carrier}. Retrouvez le bordereau dans votre espace client.`),
    ]);
  }
  const customer = preorder?.fboNomComplet || "";
  const parcelNumber =
    preorder?.parcelNumber || preorder?.preorderNumber || preorder?.id || "-";

  return prependNotificationPrefix(
    preorder,
    firstSmsCandidate([
      `Bonjour ${customer}, votre commande est clôturée. Colis ${parcelNumber} livré avec succès. Merci pour votre confiance.`,
      `Bonjour ${customer}, commande clôturée. Colis ${parcelNumber} livré avec succès.`,
      `Commande clôturée. Colis ${parcelNumber} livré.`,
    ]),
  );
}

function buildPaymentConfirmedSmsMessage({ preorder }) {
  const customer = preorder?.fboNomComplet || "";
  const preorderNumber =
    preorder?.preorderNumber || preorder?.paymentCollectionCode || preorder?.id || "-";
  const total = formatFcfa(preorder?.totalFcfa || preorder?.as400InvoiceTotalFcfa || 0);

  return prependNotificationPrefix(
    preorder,
    firstSmsCandidate([
      `Bonjour ${customer}, le paiement de votre précommande est confirmé pour ${total}.`,
      `Bonjour ${customer}, paiement confirmé pour ${total}.`,
      `Paiement confirmé pour ${total}.`,
    ]),
  );
}

function formatFcfa(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0 FCFA";
  return `${new Intl.NumberFormat("fr-FR").format(Math.max(0, Math.round(num)))} FCFA`;
}

function formatCc(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0,000 CC";
  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(Math.max(0, num))} CC`;
}

function formatOptionalContactLine(label, value) {
  const normalized = compactText(value || "");
  if (!normalized) return null;
  return `${label}: ${normalized}`;
}

function buildEmailSubjectByPurpose({ purpose, preorder }) {
  const normalizedPurpose = String(purpose || "").trim().toUpperCase();
  const preorderNumber = preorder?.preorderNumber || preorder?.id || "-";
  if (normalizedPurpose === 'ORDER_FULFILLED' && require('./shipping.service').isShipping(preorder?.deliveryMode)) return `FOREVER - Colis remis au transporteur (${preorderNumber})`;

  if (normalizedPurpose === "INVOICE" || normalizedPurpose === "PAYMENT_LINK") {
    return `FOREVER CI - Précommande ${preorderNumber} disponible pour paiement`;
  }
  if (normalizedPurpose === "ORDER_READY") {
    return `FOREVER CI - Colis prêt (${preorderNumber})`;
  }
  if (normalizedPurpose === "PREPARATION_STARTED") {
    return `FOREVER CI - Préparation en cours (${preorderNumber})`;
  }
  if (normalizedPurpose === "ORDER_FULFILLED") {
    return `FOREVER CI - Commande clôturée (${preorderNumber})`;
  }
  if (normalizedPurpose === "PAYMENT_CONFIRMED") {
    return `FOREVER CI - Paiement confirmé (${preorderNumber})`;
  }
  return `FOREVER CI - Notification commande (${preorderNumber})`;
}

// Partagées entre INVOICE/PAYMENT_LINK et REMINDER, qui décrivent le même
// mode de règlement avec un ton différent (première demande vs relance).
function buildPaymentLinkLine({ paymentLink, isBankTransferFlow }) {
  if (!paymentLink) return "Mode de paiement: règlement à la caisse FLP";
  return isBankTransferFlow
    ? `Lien sécurisé de dépôt de preuve: ${paymentLink}`
    : `Lien de paiement sécurisé: ${paymentLink}`;
}

function buildPaymentActionLine({ paymentLink, isBankTransferFlow, isEcobankPayFlow }) {
  if (!paymentLink) return "Présentez le code encaissement ci-dessus au comptoir pour régler.";
  if (!isBankTransferFlow) return "Finalisez votre paiement en ligne via le lien ci-dessus.";
  return isEcobankPayFlow
    ? "Ouvrez le lien ci-dessus, joignez votre preuve Ecobank Pay et validez l'envoi."
    : "Ouvrez le lien ci-dessus, joignez votre preuve de virement et validez l'envoi.";
}

function buildDefaultEmailBodyByPurpose({
  purpose,
  preorder,
  smsMessage,
  paymentLinkTarget = null,
  paymentLinkTracked = null,
  supportPhone = null,
  pickupAddress = null,
}) {
  if (require('./shipping.service').isShipping(preorder?.deliveryMode) && ['ORDER_READY', 'ORDER_FULFILLED'].includes(String(purpose).toUpperCase())) {
    return String(purpose).toUpperCase() === 'ORDER_READY'
      ? preorder.shippingFeeFcfa === 0 ? smsMessage : [smsMessage, 'Les produits sont déjà payés. Les frais d’expédition sont à régler séparément avant la remise au transporteur.', 'Retrouvez le montant et le bouton de paiement dans votre espace client.'].join('\n\n')
      : [smsMessage, `Bordereau : ${preorder.deliveryTracking || 'Non renseigné'}`, `Destination : ${preorder.shippingDestinationCity || '-'}`, `Remis au transporteur le : ${new Date(preorder.shippingHandedOverAt || preorder.fulfilledAt).toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' })}`, 'La remise au transporteur ne constitue pas une confirmation de livraison au destinataire.'].join('\n\n');
  }
  const normalizedPurpose = String(purpose || "").trim().toUpperCase();
  const customer = preorder?.fboNomComplet || "Client";
  const preorderNumber = preorder?.preorderNumber || preorder?.id || "-";
  const parcelNumber = preorder?.parcelNumber || preorderNumber;
  const paymentCollectionCode =
    preorder?.paymentCollectionCode || preorder?.preorderNumber || preorder?.id || "-";
  const total = formatFcfa(preorder?.totalFcfa || preorder?.as400InvoiceTotalFcfa || 0);
  const totalCc = formatCc(preorder?.totalCc || 0);
  const paymentLink = String(paymentLinkTracked || paymentLinkTarget || "").trim();
  const pickupCode = preorder?.pickupSecretCode || "-";
  const paymentMode = String(
    preorder?.preorderPaymentMode || preorder?.paymentMode || preorder?.paymentProvider || "",
  )
    .trim()
    .toUpperCase();
  const isEcobankPayFlow =
    paymentMode === "ECOBANK_PAY" ||
    paymentMode === "PI_SPI" ||
    paymentMode.includes("ECOBANK") ||
    paymentMode.includes("SPI");
  const isBankTransferFlow =
    isEcobankPayFlow ||
    paymentMode === "BANK_TRANSFER" ||
    paymentMode.includes("BANK_TRANSFER") ||
    paymentMode.includes("VIREMENT") ||
    paymentMode.includes("BANK");
  const supportLine = formatOptionalContactLine("Assistance", supportPhone);
  const pickupAddressLine = formatOptionalContactLine(
    "Adresse de retrait",
    pickupAddress,
  );

  if (normalizedPurpose === "INVOICE" || normalizedPurpose === "PAYMENT_LINK") {
    const expiryHours = getPaymentExpiryHours();
    return [
      `Bonjour ${customer},`,
      "",
      `Votre précommande ${preorderNumber} est disponible pour paiement.`,
      `Code encaissement: ${paymentCollectionCode}`,
      `Montant à payer: ${total}`,
      `Total CC: ${totalCc}`,
      buildPaymentLinkLine({ paymentLink, isBankTransferFlow }),
      "",
      `Cette préfacture reste payable pendant ${expiryHours}h maximum après émission.`,
      buildPaymentActionLine({ paymentLink, isBankTransferFlow, isEcobankPayFlow }),
      supportLine,
      "",
      "Merci pour votre confiance.",
      "Equipe FOREVER",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (normalizedPurpose === "REMINDER") {
    const expiryHours = getPaymentExpiryHours();
    return [
      `Bonjour ${customer},`,
      "",
      `Rappel : votre précommande ${preorderNumber} est toujours en attente de paiement.`,
      `Code encaissement: ${paymentCollectionCode}`,
      `Montant à payer: ${total}`,
      buildPaymentLinkLine({ paymentLink, isBankTransferFlow }),
      "",
      `Cette préfacture expire ${expiryHours}h après son émission.`,
      buildPaymentActionLine({ paymentLink, isBankTransferFlow, isEcobankPayFlow }),
      supportLine,
      "",
      "Merci pour votre confiance.",
      "Equipe FOREVER",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (normalizedPurpose === "ORDER_READY") {
    return [
      `Bonjour ${customer},`,
      "",
      `Votre colis ${parcelNumber} est prêt à être retiré.`,
      `Code de retrait: ${pickupCode}`,
      pickupAddressLine,
      "",
      "Présentez ce code au comptoir pour sécuriser la remise.",
      "Sans ce code, le retrait peut être refusé.",
      supportLine,
      "Equipe FOREVER",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (normalizedPurpose === "PREPARATION_STARTED") {
    return [
      `Bonjour ${customer},`,
      "",
      `Votre colis ${parcelNumber} est en cours de préparation.`,
      "Nos équipes finalisent la préparation de votre commande.",
      "Vous recevrez une nouvelle notification dès qu'il sera prêt au retrait.",
      supportLine,
      "",
      "Equipe FOREVER",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (normalizedPurpose === "PAYMENT_CONFIRMED") {
    return [
      `Bonjour ${customer},`,
      "",
      `Votre paiement pour la commande ${preorderNumber} a été confirmé.`,
      `Montant confirmé: ${total}`,
      "Votre commande suit désormais son traitement normal.",
      "Vous recevrez une nouvelle notification dès le lancement de la préparation.",
      supportLine,
      "",
      "Merci pour votre confiance.",
      "Equipe FOREVER",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (normalizedPurpose === "ORDER_FULFILLED") {
    return [
      `Bonjour ${customer},`,
      "",
      `Le retrait du colis ${parcelNumber} a été confirmé.`,
      `Commande associée: ${preorderNumber}`,
      "Cette commande est désormais clôturée avec succès.",
      supportLine,
      "",
      "Merci pour votre confiance.",
      "Equipe FOREVER",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `Bonjour ${customer},`,
    "",
    `Mise à jour de votre commande ${preorderNumber}.`,
    "",
    compactText(smsMessage || ""),
    "",
    "Equipe FOREVER",
  ].join("\n");
}

function buildDefaultEmailHtml({
  subject,
  body,
  preorder,
  ctaHref = "",
  ctaLabel = "",
  supportPhone = "",
}) {
  const preorderNumber = preorder?.preorderNumber || preorder?.id || "-";
  const safeSubject = subject || `Notification commande ${preorderNumber}`;
  // Le bouton ci-dessous reprend déjà ce lien : on évite de l'afficher une
  // seconde fois en texte brut dans le rendu HTML. Le corps texte brut
  // (utilisé pour le SMS et le fallback texte de l'email, qui n'ont pas de
  // bouton) garde la ligne telle quelle.
  const htmlSourceText = ctaHref
    ? String(body || "")
        .split("\n")
        .filter((line) => !line.includes(ctaHref))
        .join("\n")
    : body;
  const bodyHtml = textToHtml(htmlSourceText) + renderButton({ href: ctaHref, label: ctaLabel });

  return renderLayout({
    previewText: safeSubject,
    title: safeSubject,
    bodyHtml,
    headerTag: `Précommande ${preorderNumber}`,
    supportPhone,
  });
}

function normalizePurposeKey(purpose = "") {
  const key = String(purpose || "").trim().toUpperCase();
  if (key === "PAYMENT_LINK") return "INVOICE";
  if (key === "REMINDER") return "REMINDER";
  if (key === "ORDER_FULFILLED") return "ORDER_FULFILLED";
  return key;
}

function shouldSendSmsForPurpose(purpose = "") {
  const key = String(purpose || "").trim().toUpperCase();
  // Politique SMS essentielle: on réserve le crédit aux messages qui
  // déclenchent une action client ou un déplacement.
  return new Set([
    "PREORDER_SUBMITTED",
    "INVOICE",
    "PAYMENT_LINK",
    "REMINDER",
    "ORDER_READY",
    "SHIPPING_PAYMENT_LINK",
  ]).has(key);
}

const ORDER_MESSAGE_PURPOSE_VALUES = new Set([
  "INVOICE",
  "PAYMENT_LINK",
  "REMINDER",
  "PAYMENT_CONFIRMED",
  "PREPARATION_STARTED",
  "ORDER_READY",
  "ORDER_FULFILLED",
]);

function resolvePersistedOrderMessagePurpose(purpose = "") {
  const key = String(purpose || "").trim().toUpperCase();
  if (key === "SHIPPING_PAYMENT_LINK") return "PAYMENT_LINK";
  if (ORDER_MESSAGE_PURPOSE_VALUES.has(key)) return key;

  // Compatibilité rétroactive: certains flux utilisent PREORDER_SUBMITTED
  // alors que l'enum Prisma ne le contient pas.
  if (key === "PREORDER_SUBMITTED") return "REMINDER";
  if (key === "AUTO_CANCEL") return "REMINDER";

  return "REMINDER";
}

function resolvePaymentFlowKey(preorder = {}, paymentLink = "") {
  const mode = String(
    preorder?.preorderPaymentMode ||
      preorder?.paymentMode ||
      preorder?.paymentProvider ||
      "",
  )
    .trim()
    .toUpperCase();
  const hasPaymentLink = Boolean(String(paymentLink || "").trim());
  const isPiSpi = mode === "PI_SPI" || mode.includes("SPI");
  const isEcobankPay = mode === "ECOBANK_PAY" || mode.includes("ECOBANK");
  const isBankTransfer =
    !isEcobankPay &&
    (mode === "BANK_TRANSFER" ||
      mode.includes("BANK_TRANSFER") ||
      mode.includes("VIREMENT") ||
      mode.includes("BANK"));
  const isCash = mode.includes("ESPE") || mode === "MANUAL" || mode === "CASH";

  if (isPiSpi) return "PI_SPI";
  if (isEcobankPay) return "ECOBANK_PAY";
  if (isBankTransfer) return "BANK_TRANSFER";
  if (hasPaymentLink || mode.includes("WAVE")) return "WAVE";
  if (isCash) return "CASH";
  return "CASH";
}

async function findRecentDuplicateOrderMessage({
  preorderId,
  purpose,
  channel,
  message,
  toPhone = null,
  dedupWindowSeconds = 60,
}) {
  const seconds = Math.max(0, Number(dedupWindowSeconds) || 0);
  if (!seconds) return null;
  const since = new Date(Date.now() - seconds * 1000);

  return prisma.orderMessage.findFirst({
    where: {
      preorderId,
      purpose,
      channel,
      body: String(message || ""),
      status: { in: ["QUEUED", "SENT", "DELIVERED", "READ"] },
      ...(channel === "EMAIL"
        ? {}
        : { toPhone: toPhone ? String(toPhone) : null }),
      ...(channel === "SMS" ? { OR: [{ status: "QUEUED" }, { createdAt: { gte: since } }] } : { createdAt: { gte: since } }),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      provider: true,
      providerMessageId: true,
      status: true,
      createdAt: true,
    },
  });
}

function getNestedTemplate(root, path = []) {
  return path.reduce((acc, key) => {
    if (!acc || typeof acc !== "object") return null;
    return acc[key];
  }, root);
}

function interpolateTemplate(template = "", context = {}) {
  const raw = String(template || "");
  return raw.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, token) => {
    const value = context[token];
    return value === undefined || value === null ? "" : String(value);
  });
}

async function loadCountryNotificationTemplates(countryId) {
  if (!countryId) return null;
  try {
    const settings = await prisma.countrySettings.findUnique({
      where: { countryId: String(countryId) },
      select: {
        notificationTemplates: true,
        supportPhone: true,
        pickupAddress: true,
        bankName: true,
        bankAccountHolder: true,
        bankAccountNumber: true,
        bankIban: true,
      },
    });
    if (!settings) return null;
    return settings;
  } catch {
    return null;
  }
}

function buildTemplateContext({
  preorder,
  purpose,
  paymentLinkTarget,
  paymentLinkTracked,
  supportPhone = null,
  pickupAddress = null,
  bankAccount = null,
}) {
  const customerName = preorder?.fboNomComplet || "Client";
  const preorderNumber = preorder?.preorderNumber || preorder?.id || "-";
  const parcelNumber = preorder?.parcelNumber || preorderNumber;
  const paymentCollectionCode =
    preorder?.paymentCollectionCode || preorder?.preorderNumber || preorder?.id || "-";
  const totalFcfa = Number(
    preorder?.totalFcfa || preorder?.as400InvoiceTotalFcfa || 0,
  );
  const paymentLink = String(paymentLinkTracked || paymentLinkTarget || "").trim();
  const pickupCode = preorder?.pickupSecretCode || "-";
  const paymentFlow = resolvePaymentFlowKey(preorder, paymentLink);
  const bankProofUploadLink =
    ["BANK_TRANSFER", "ECOBANK_PAY", "PI_SPI"].includes(paymentFlow) ? paymentLink : "";
  const paymentExpiryHours = resolvePaymentExpiryHoursForPreorder(preorder);

  return {
    purpose: normalizePurposeKey(purpose),
    preorder,
    customerName,
    preorderNumber,
    parcelNumber,
    invoiceRef: preorderNumber,
    paymentCollectionCode,
    totalFcfa: String(Math.max(0, Math.round(totalFcfa))),
    totalFcfaLabel: formatFcfa(totalFcfa),
    paymentLink,
    bankProofUploadLink,
    paymentFlow,
    pickupCode,
    paymentExpiryHours: String(paymentExpiryHours),
    supportPhone: supportPhone || "",
    pickupAddress: pickupAddress || "",
    bankName: bankAccount?.bankName || "",
    bankAccountHolder: bankAccount?.bankAccountHolder || "",
    bankAccountNumber: bankAccount?.bankAccountNumber || "",
    bankIban: bankAccount?.bankIban || "",
    bankAccountDetails: formatBankAccountDetails(bankAccount),
    // Ligne complète, vide si aucun compte n'est configuré pour le pays.
    bankAccountLine: formatBankAccountDetails(bankAccount)
      ? `Compte de virement : ${formatBankAccountDetails(bankAccount)}`
      : "",
  };
}

// Coordonnées du compte de virement (réglages pays) sur une ligne, pour les modèles.
function formatBankAccountDetails(bankAccount) {
  return [
    bankAccount?.bankAccountHolder,
    bankAccount?.bankName,
    bankAccount?.bankAccountNumber,
    bankAccount?.bankIban ? `IBAN ${bankAccount.bankIban}` : null,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" - ");
}

function resolvePaymentExpiryHoursForPreorder(preorder) {
  const defaultHours = getPaymentExpiryHours();
  const invoicedAt = preorder?.invoicedAt ? new Date(preorder.invoicedAt) : null;
  const paymentExpiresAt = preorder?.paymentExpiresAt
    ? new Date(preorder.paymentExpiresAt)
    : null;
  if (
    invoicedAt &&
    paymentExpiresAt &&
    !Number.isNaN(invoicedAt.getTime()) &&
    !Number.isNaN(paymentExpiresAt.getTime()) &&
    paymentExpiresAt.getTime() > invoicedAt.getTime()
  ) {
    return Math.max(
      1,
      Math.ceil((paymentExpiresAt.getTime() - invoicedAt.getTime()) / (60 * 60 * 1000)),
    );
  }
  return defaultHours;
}

function buildSmsTemplateCandidates({ purpose, context }) {
  const purposeKey = normalizePurposeKey(purpose);
  if (purposeKey !== "INVOICE") return [purposeKey];

  const flow = String(context?.paymentFlow || "CASH").toUpperCase();
  if (flow === "WAVE") {
    return ["INVOICE_WAVE", "INVOICE"];
  }
  if (flow === "ECOBANK_PAY") {
    return ["INVOICE_ECOBANK_PAY", "INVOICE_BANK_TRANSFER", "INVOICE"];
  }
  if (flow === "PI_SPI") {
    return ["INVOICE_PI_SPI", "INVOICE_BANK_TRANSFER", "INVOICE"];
  }
  if (flow === "BANK_TRANSFER") {
    return ["INVOICE_BANK_TRANSFER", "INVOICE"];
  }
  return ["INVOICE_CASH", "INVOICE"];
}

function buildEmailTemplateCandidates({ purpose, context }) {
  const purposeKey = normalizePurposeKey(purpose);
  const flow = String(context?.paymentFlow || "CASH").toUpperCase();

  if (purposeKey === "PAYMENT_LINK") {
    return ["PAYMENT_LINK", "INVOICE_WAVE", "INVOICE"];
  }

  if (purposeKey === "INVOICE" && flow === "ECOBANK_PAY") {
    return ["INVOICE_ECOBANK_PAY", "INVOICE_BANK_TRANSFER", "INVOICE"];
  }
  if (purposeKey === "INVOICE" && flow === "PI_SPI") {
    return ["INVOICE_PI_SPI", "INVOICE_BANK_TRANSFER", "INVOICE"];
  }

  if (purposeKey === "INVOICE" && flow === "BANK_TRANSFER") {
    return ["INVOICE_BANK_TRANSFER", "INVOICE"];
  }

  if (purposeKey === "REMINDER" && (flow === "ECOBANK_PAY" || flow === "PI_SPI" || flow === "BANK_TRANSFER")) {
    return ["REMINDER_BANK_TRANSFER", "REMINDER"];
  }

  return [purposeKey];
}

function ensureEmailBodyIncludesActionLink({ purpose, context, emailBody }) {
  const body = String(emailBody || "").trim();
  const paymentLink = String(context?.paymentLink || "").trim();
  if (!body || !paymentLink) return body;

  const purposeKey = normalizePurposeKey(purpose);
  if (!["INVOICE", "PAYMENT_LINK", "REMINDER"].includes(purposeKey)) return body;

  if (body.includes(paymentLink)) return body;

  const flow = String(context?.paymentFlow || "").toUpperCase();
  const label =
    flow === "BANK_TRANSFER" || flow === "ECOBANK_PAY" || flow === "PI_SPI"
      ? "Lien sécurisé de dépôt de preuve"
      : "Lien de paiement sécurisé";

  return `${body}\n\n${label}: ${paymentLink}`.trim();
}

function sanitizeInvoiceSmsMessage(value = "") {
  let msg = compactText(value || "");
  if (!msg) return msg;

  msg = msg.replace(/^FOREVER:\s*FOREVER:\s*/i, "");
  msg = msg.replace(/^FOREVER:\s*/i, "");
  msg = msg.replace(/^[A-Z]{3}-\d{8}-\d+\.\s*/i, "");
  msg = msg.replace(/\s*(Paiement|Lien)\s*:\s*$/i, "");
  msg = msg.replace(/\s{2,}/g, " ").trim();
  return msg;
}

function ensureInvoiceSmsIncludesCollectionCode({
  purpose,
  smsMessage,
  paymentCollectionCode,
}) {
  const purposeKey = normalizePurposeKey(purpose);
  if (purposeKey !== "INVOICE") return firstSmsCandidate([compactText(smsMessage)]);

  const normalizedCode = compactText(paymentCollectionCode || "");
  const normalizedMessage = sanitizeInvoiceSmsMessage(smsMessage);

  if (!normalizedCode) return firstSmsCandidate([normalizedMessage]);

  if (normalizedMessage.includes(normalizedCode)) {
    return firstSmsCandidate([normalizedMessage]);
  }

  if (/^Code\s+/i.test(normalizedMessage)) {
    return firstSmsCandidate([normalizedMessage]);
  }

  return firstSmsCandidate([
    `Code ${normalizedCode}. ${normalizedMessage}`,
    `Code caisse ${normalizedCode}.`,
  ]);
}

function compactPaymentLinkSmsIfNeeded({ purpose, context, smsMessage }) {
  const normalized = compactText(smsMessage || "");
  const paymentLink = compactText(context?.paymentLink || "");
  if (!paymentLink || normalized.length <= MAX_SMS_LENGTH) return normalized;

  const purposeKey = normalizePurposeKey(purpose);
  if (!["INVOICE", "PAYMENT_LINK", "REMINDER"].includes(purposeKey)) {
    return firstSmsCandidate([normalized]);
  }

  const flow = String(context?.paymentFlow || "").toUpperCase();
  const code = compactText(context?.paymentCollectionCode || context?.preorderNumber || "");
  const amount = compactText(context?.totalFcfaLabel || "")
    .replace(/\s*FCFA$/i, "F")
    .replace(/\s+/g, "");
  const isBankFlow = ["BANK_TRANSFER", "ECOBANK_PAY", "PI_SPI"].includes(flow);
  const action = isBankFlow ? "Depot preuve" : "Wave";
  const reminderPrefix = purposeKey === "REMINDER" ? "Rappel. " : "";

  return firstSmsCandidate([
    prependNotificationPrefix(
      context?.preorder || null,
      `${reminderPrefix}Code ${code}. ${amount}. ${action}: ${paymentLink}`,
    ),
    prependNotificationPrefix(
      context?.preorder || null,
      `${reminderPrefix}${code}. ${amount}. ${action}: ${paymentLink}`,
    ),
    prependNotificationPrefix(
      context?.preorder || null,
      `${action} ${code}: ${paymentLink}`,
    ),
    normalized,
  ]);
}

function resolveConfiguredTemplates({
  templatesRoot,
  purpose,
  context,
  fallbackSms,
  fallbackEmailSubject,
  fallbackEmailBody,
}) {
  if (normalizePurposeKey(purpose) === "SHIPPING_PAYMENT_LINK") {
    return { smsMessage: prependNotificationPrefix(context.preorder, fallbackSms), emailSubject: fallbackEmailSubject, emailBody: fallbackEmailBody,
      emailHtml: buildDefaultEmailHtml({ subject: fallbackEmailSubject, body: fallbackEmailBody, preorder: context.preorder, ctaHref: context.paymentLink, ctaLabel: "Payer les frais d’expédition", supportPhone: context.supportPhone }) };
  }
  if (require('./shipping.service').isShipping(context?.preorder?.deliveryMode) && ['ORDER_READY', 'ORDER_FULFILLED'].includes(normalizePurposeKey(purpose))) {
    return { smsMessage: fallbackSms, emailSubject: fallbackEmailSubject, emailBody: fallbackEmailBody, emailHtml: buildDefaultEmailHtml({ subject: fallbackEmailSubject, body: fallbackEmailBody, preorder: context.preorder }) };
  }
  const purposeKey = normalizePurposeKey(purpose);
  const smsPurposeCandidates = buildSmsTemplateCandidates({ purpose, context });
  const emailPurposeCandidates = buildEmailTemplateCandidates({ purpose, context });

  const smsTemplate = smsPurposeCandidates
    .map((key) => getNestedTemplate(templatesRoot, ["sms", key]))
    .find(Boolean);
  const emailSubjectTemplate = emailPurposeCandidates
    .map((key) => getNestedTemplate(templatesRoot, ["email", key, "subject"]))
    .find(Boolean);
  const emailBodyTemplate = emailPurposeCandidates
    .map((key) => getNestedTemplate(templatesRoot, ["email", key, "body"]))
    .find(Boolean);

  const resolvedSms = compactText(
    smsTemplate ? interpolateTemplate(smsTemplate, context) : fallbackSms,
  );
  const resolvedSubject = compactText(
    emailSubjectTemplate
      ? interpolateTemplate(emailSubjectTemplate, context)
      : fallbackEmailSubject,
  );
  const interpolatedEmailBody = String(
    emailBodyTemplate
      ? interpolateTemplate(emailBodyTemplate, context)
      : fallbackEmailBody,
  )
    .replace(/\r\n/g, "\n")
    .trim();
  const resolvedEmailBody = ensureEmailBodyIncludesActionLink({
    purpose,
    context,
    emailBody: interpolatedEmailBody,
  });
  const paymentFlow = String(context?.paymentFlow || "").toUpperCase();
  const isBankFlow = ["BANK_TRANSFER", "ECOBANK_PAY", "PI_SPI"].includes(paymentFlow);
  const resolvedEmailHtml = buildDefaultEmailHtml({
    subject: resolvedSubject || fallbackEmailSubject,
    body: resolvedEmailBody || fallbackEmailBody,
    preorder: context?.preorder || null,
    ctaHref: context?.paymentLink || "",
    ctaLabel: isBankFlow ? "Déposer ma preuve de paiement" : "Payer maintenant",
    supportPhone: context?.supportPhone || "",
  });

  return {
    smsMessage: compactPaymentLinkSmsIfNeeded({
      purpose,
      context,
      smsMessage: prependNotificationPrefix(
        context?.preorder || null,
        ensureInvoiceSmsIncludesCollectionCode({
          purpose,
          smsMessage: resolvedSms || fallbackSms,
          paymentCollectionCode: context?.paymentCollectionCode,
        }),
      ),
    }),
    emailSubject: resolvedSubject || fallbackEmailSubject,
    emailBody: resolvedEmailBody || fallbackEmailBody,
    emailHtml: resolvedEmailHtml,
  };
}

async function persistNotificationResult({
  preorderId,
  channel,
  purpose,
  toPhone = null,
  toEmail = null,
  message,
  paymentLinkTarget = null,
  paymentLinkTracked = null,
  actorName,
  sendResult,
  events = [],
}) {
  const now = new Date();
  const finalMessageStatus = sendResult.accepted ? "SENT" : "FAILED";

  const createdMessage = await prisma.orderMessage.create({
    data: {
      preorderId,
      channel,
      purpose,
      status: "QUEUED",
      toPhone,
      provider: sendResult.provider || null,
      paymentLinkTarget: paymentLinkTarget || null,
      paymentLinkTracked: paymentLinkTracked || null,
      createdBy: actorName || "SYSTEM",
      body: message,
    },
  });

  const savedMessage = await prisma.orderMessage.update({
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

  await prisma.orderMessageEvent.create({
    data: {
      orderMessageId: savedMessage.id,
      status: finalMessageStatus,
      rawPayload: sendResult.rawPayload || null,
      note: sendResult.accepted
        ? `Notification ${channel} envoyée${channel === "EMAIL" && toEmail ? ` à ${toEmail}` : channel !== "EMAIL" && toPhone ? ` à ${toPhone}` : ""}.`
        : `Échec de la notification ${channel}${channel === "EMAIL" && toEmail ? ` à ${toEmail}` : channel !== "EMAIL" && toPhone ? ` à ${toPhone}` : ""}.`,
    },
  });

  for (const evt of events) {
    await prisma.orderMessageEvent.create({
      data: {
        orderMessageId: savedMessage.id,
        status: String(evt?.status || "INFO"),
        rawPayload: evt?.rawPayload || null,
        note: evt?.note ? String(evt.note) : null,
      },
    });
  }

  return savedMessage;
}

async function queueSmsNotification({
  preorderId,
  purpose,
  toPhone = null,
  message,
  paymentLinkTarget = null,
  paymentLinkTracked = null,
  actorName,
  maxAttempts = getNotificationMaxSmsAttempts(),
}) {
  const now = new Date();
  const queuedMessage = await prisma.orderMessage.create({
    data: {
      preorderId,
      channel: "SMS",
      purpose,
      status: "QUEUED",
      toPhone,
      provider: "ORANGE",
      paymentLinkTarget: paymentLinkTarget || null,
      paymentLinkTracked: paymentLinkTracked || null,
      createdBy: actorName || "SYSTEM",
      body: message,
      attempts: 0,
      maxAttempts: Math.max(1, Number(maxAttempts) || getNotificationMaxSmsAttempts()),
      nextAttemptAt: now,
    },
  });

  await prisma.orderMessageEvent.create({
    data: {
      orderMessageId: queuedMessage.id,
      status: "QUEUED",
      note: `Notification SMS ajoutée à la file d'envoi pour ${toPhone || "destinataire inconnu"}.`,
    },
  });

  return queuedMessage;
}

const WHATSAPP_SMS_FALLBACK_EVENT = "SMS_FALLBACK_QUEUED";
// Au-delà, le SMS arriverait trop tard pour être utile (ou contredirait un
// message plus récent) : on n'en envoie pas.
const WHATSAPP_SMS_FALLBACK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Secours SMS pour un WhatsApp accepté par MailerSend puis signalé en échec
 * par webhook (numéro sans WhatsApp, message non distribuable...). Une seule
 * fois par message, dans les 24 h, et uniquement pour les messages que la
 * politique SMS autorise. Renvoie le message SMS mis en file, ou null.
 */
async function queueSmsFallbackForFailedWhatsApp(orderMessageId) {
  const message = await prisma.orderMessage.findUnique({
    where: { id: orderMessageId },
    include: {
      events: { where: { status: WHATSAPP_SMS_FALLBACK_EVENT }, select: { id: true } },
      preorder: {
        select: {
          id: true,
          deliveryMode: true,
          factureWhatsappTo: true,
          country: { select: { code: true } },
        },
      },
    },
  });
  if (!message || message.channel !== "WHATSAPP" || message.events.length > 0) return null;
  if (!message.body || Date.now() - new Date(message.createdAt).getTime() > WHATSAPP_SMS_FALLBACK_MAX_AGE_MS) {
    return null;
  }

  const preorder = message.preorder;
  const smsAllowed =
    shouldSendSmsForPurpose(message.purpose) ||
    (message.purpose === "ORDER_FULFILLED" && require("./shipping.service").isShipping(preorder?.deliveryMode));
  const smsPhone = resolveNotificationPhone(preorder);
  if (!smsAllowed || !smsPhone || !normalizeForCountry(smsPhone, preorder?.country?.code || "CIV")) {
    return null;
  }

  const fallbackMessage = await queueSmsNotification({
    preorderId: message.preorderId,
    purpose: message.purpose,
    toPhone: smsPhone,
    message: message.body,
    paymentLinkTarget: message.paymentLinkTarget,
    paymentLinkTracked: message.paymentLinkTracked,
    actorName: "SYSTEM",
  });
  await prisma.orderMessageEvent.create({
    data: {
      orderMessageId: message.id,
      status: WHATSAPP_SMS_FALLBACK_EVENT,
      note: `WhatsApp non distribué : SMS de secours mis en file (${fallbackMessage.id}).`,
    },
  });
  return fallbackMessage;
}

async function sendSmsWithRetry({
  to,
  message,
  callbackData,
  countryCode = "CIV",
  maxRetries = 2,
}) {
  const retries = Math.max(0, Number(maxRetries) || 0);
  const events = [];
  let lastResult = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    // Tentative immédiate (pas d'attente active côté API)
    const result = await sendSms({
      to,
      message,
      callbackData,
      countryCode,
    });
    lastResult = result;

    events.push({
      status: result.accepted ? "ATTEMPT_SENT" : "ATTEMPT_FAILED",
      rawPayload: result.rawPayload || null,
      note: result.accepted
        ? `SMS envoyé (tentative ${attempt + 1}/${retries + 1}).`
        : `Échec SMS (tentative ${attempt + 1}/${retries + 1}): ${result.errorMessage || result.errorCode || "Erreur inconnue"}`,
    });

    if (result.accepted) {
      return { ...result, events };
    }
  }

  return { ...(lastResult || {}), events };
}

async function sendByChannel({
  channel,
  to,
  message,
  html,
  subject,
  preorderId,
  countryCode = "CIV",
  maxSmsRetries = 2,
  whatsappPurpose = null,
  whatsappContext = null,
}) {
  if (!to) {
    return {
      accepted: false,
      provider: null,
      providerMessageId: null,
      rawPayload: null,
      errorCode: "NO_DESTINATION",
      errorMessage: `Aucune destination pour le canal ${channel}.`,
      events: [],
    };
  }

  if (channel === "SMS") {
    return sendSmsWithRetry({
      to,
      message,
      callbackData: preorderId,
      countryCode,
      maxRetries: maxSmsRetries,
    });
  }

  if (channel === "WHATSAPP") {
    return whatsappService.sendPreorderWhatsAppNotification({
      to,
      purpose: whatsappPurpose,
      context: whatsappContext || {},
      fallbackMessage: message,
      metadata: {
        preorderId,
      },
      countryCode,
    });
  }

  if (channel === "EMAIL") {
    return sendEmail({
      to,
      subject: subject || "Notification commande FOREVER",
      body: message,
      html: html || undefined,
      metadata: {
        preorderId,
      },
    });
  }

  return {
    accepted: false,
    provider: null,
    providerMessageId: null,
    rawPayload: null,
    errorCode: "CHANNEL_NOT_SUPPORTED",
    errorMessage: `Canal non supporté: ${channel}`,
    events: [],
  };
}

async function sendPreorderNotification({
  preorder,
  purpose,
  message,
  emailSubject = null,
  emailMessage = null,
  actorName = "SYSTEM",
  toPhone = null,
  toWhatsapp = null,
  toEmail = null,
  paymentLinkTarget = null,
  paymentLinkTracked = null,
  maxSmsRetries = 2,
  forceChannel = null,
}) {
  if (!preorder?.id || !message) {
    return { sent: false, skipped: true, reason: "INVALID_NOTIFICATION" };
  }

  const persistedPurpose = resolvePersistedOrderMessagePurpose(purpose);
  const pushPurpose = String(purpose).toUpperCase() === "SHIPPING_PAYMENT_LINK" ? "SHIPPING_PAYMENT_LINK" : persistedPurpose;

  const contactPhone = toPhone || resolveNotificationPhone(preorder);
  const resolvedWhatsapp = toWhatsapp || preorder?.contactWhatsapp || contactPhone;
  // Le SMS passe par l'opérateur du pays : un numéro étranger n'est joignable
  // que sur WhatsApp (ou par email).
  const smsCountryCode = await resolvePreorderCountryCode(preorder);
  const resolvedPhone = contactPhone && normalizeForCountry(contactPhone, smsCountryCode) ? contactPhone : null;
  const resolvedEmail = resolveNotificationEmail(preorder, toEmail);
  const defaultEmailSubject =
    String(emailSubject || "").trim() ||
    buildEmailSubjectByPurpose({ purpose, preorder });
  const fallbackSmsMessage = firstSmsCandidate([compactText(message || "")]);

  const countryTemplateSettings = await loadCountryNotificationTemplates(
    preorder?.countryId || preorder?.country?.id || null,
  );
  const defaultEmailMessage =
    String(emailMessage || "").trim() ||
    buildDefaultEmailBodyByPurpose({
      purpose,
      preorder,
      smsMessage: message,
      paymentLinkTarget,
      paymentLinkTracked,
      supportPhone: countryTemplateSettings?.supportPhone || null,
      pickupAddress: countryTemplateSettings?.pickupAddress || null,
    });
  const context = buildTemplateContext({
    preorder,
    purpose,
    paymentLinkTarget,
    paymentLinkTracked,
    supportPhone: countryTemplateSettings?.supportPhone || null,
    pickupAddress: countryTemplateSettings?.pickupAddress || null,
    bankAccount: countryTemplateSettings,
  });
  const configuredTemplates = resolveConfiguredTemplates({
    templatesRoot: countryTemplateSettings?.notificationTemplates || null,
    purpose,
    context,
    fallbackSms: fallbackSmsMessage,
    fallbackEmailSubject: defaultEmailSubject,
    fallbackEmailBody: defaultEmailMessage,
  });
  const resolvedSmsMessage = configuredTemplates.smsMessage;
  const resolvedEmailSubject = configuredTemplates.emailSubject;
  const resolvedEmailMessage = configuredTemplates.emailBody;
  const resolvedEmailHtml = configuredTemplates.emailHtml;
  const preorderCountryCode = preorder?.country?.code || preorder?.countryCode || "CIV";

  const smsAllowed = shouldSendSmsForPurpose(purpose) || (persistedPurpose === 'ORDER_FULFILLED' && require('./shipping.service').isShipping(preorder?.deliveryMode));
  const forcedChannel = String(forceChannel || "").trim().toUpperCase();
  const channels = [];
  const whatsappPrimary =
    !forcedChannel &&
    Boolean(resolvedWhatsapp) &&
    whatsappService.canSendPreorderWhatsAppTemplate(purpose, context, {
      countryCode: preorderCountryCode,
    });

  if (whatsappPrimary) {
    // WhatsApp canal principal des FBO. Le SMS reste en secours, seulement
    // pour les messages que la politique SMS autorise déjà (pas de surcoût).
    channels.push({
      channel: "WHATSAPP",
      to: resolvedWhatsapp,
      smsFallbackTo: smsAllowed ? resolvedPhone : null,
    });
  } else if (smsAllowed) {
    if (forcedChannel === "WHATSAPP" && resolvedWhatsapp) {
      channels.push({ channel: "WHATSAPP", to: resolvedWhatsapp });
    } else if (resolvedPhone) {
      channels.push({ channel: "SMS", to: resolvedPhone });
    } else if (!forcedChannel && resolvedWhatsapp) {
      channels.push({ channel: "WHATSAPP", to: resolvedWhatsapp });
    }
  }

  if (resolvedEmail) {
    channels.push({ channel: "EMAIL", to: resolvedEmail });
  }

  if (!resolvedPhone && !resolvedWhatsapp && !resolvedEmail) {
    const pushResult = await sendPreorderMobilePush({
      preorder,
      purpose: pushPurpose,
      message: resolvedSmsMessage,
    });
    return {
      sent: Boolean(pushResult?.sent),
      skipped: !pushResult?.sent,
      reason: pushResult?.sent ? null : "NO_DESTINATION",
      push: pushResult,
    };
  }

  const effectiveChannels = forcedChannel
    ? channels.filter((item) => item.channel === forcedChannel)
    : channels;

  if (effectiveChannels.length === 0) {
    const pushResult = await sendPreorderMobilePush({
      preorder,
      purpose: pushPurpose,
      message: resolvedSmsMessage,
    });
    return {
      sent: Boolean(pushResult?.sent),
      skipped: !pushResult?.sent,
      reason: forcedChannel
        ? "FORCED_CHANNEL_UNAVAILABLE"
        : "CHANNEL_DISABLED_FOR_PURPOSE",
      attempts: [],
      push: pushResult,
      smsSent: false,
      smsQueued: false,
      whatsappSent: false,
      emailSent: false,
    };
  }

  const attempts = [];
  let firstSuccess = null;
  const dedupWindowSeconds = Number.parseInt(
    process.env.NOTIFICATION_DEDUP_WINDOW_SECONDS || "60",
    10,
  );
  for (const item of effectiveChannels) {
    if (!item.to) continue;

    const messageToSend =
      item.channel === "EMAIL" ? resolvedEmailMessage : resolvedSmsMessage;
    const duplicateMessage = await findRecentDuplicateOrderMessage({
      preorderId: preorder.id,
      purpose: persistedPurpose,
      channel: item.channel,
      message: messageToSend,
      toPhone: item.channel === "EMAIL" ? null : item.to,
      dedupWindowSeconds,
    });

    if (duplicateMessage) {
      const attempt = {
        channel: item.channel,
        sent: duplicateMessage.status !== "QUEUED",
        queued: duplicateMessage.status === "QUEUED",
        to: item.to,
        messageId: duplicateMessage.id,
        provider: duplicateMessage.provider || null,
        providerMessageId: duplicateMessage.providerMessageId || null,
        errorCode: null,
        errorMessage: null,
        deduplicated: true,
      };
      attempts.push(attempt);
      if (!firstSuccess) {
        firstSuccess = {
          channel: item.channel,
          toPhone: item.channel === "EMAIL" ? null : item.to,
          toEmail: item.channel === "EMAIL" ? item.to : null,
          messageId: duplicateMessage.id,
          provider: duplicateMessage.provider || null,
          providerMessageId: duplicateMessage.providerMessageId || null,
        };
      }
      continue;
    }

    if (item.channel === "SMS") {
      const queuedMessage = await queueSmsNotification({
        preorderId: preorder.id,
        purpose: persistedPurpose,
        toPhone: item.to,
        message: messageToSend,
        paymentLinkTarget,
        paymentLinkTracked,
        actorName,
        maxAttempts: Math.max(1, Number(maxSmsRetries) + 1),
      });

      const attempt = {
        channel: item.channel,
        sent: false,
        queued: true,
        to: item.to,
        messageId: queuedMessage.id,
        provider: queuedMessage.provider || "ORANGE",
        providerMessageId: null,
        errorCode: null,
        errorMessage: null,
      };
      attempts.push(attempt);
      if (!firstSuccess) {
        firstSuccess = {
          channel: item.channel,
          toPhone: item.to,
          toEmail: null,
          messageId: queuedMessage.id,
          provider: queuedMessage.provider || "ORANGE",
          providerMessageId: null,
        };
      }
      continue;
    }

    const sendResult = await sendByChannel({
      channel: item.channel,
      to: item.to,
      message: messageToSend,
      html: item.channel === "EMAIL" ? resolvedEmailHtml : undefined,
      subject: item.channel === "EMAIL" ? resolvedEmailSubject : undefined,
      preorderId: preorder.id,
      countryCode: preorderCountryCode,
      maxSmsRetries,
      // Purpose brut : SHIPPING_PAYMENT_LINK ou AUTO_CANCEL n'ont pas le même
      // modèle WhatsApp que leur équivalent enum (PAYMENT_LINK, REMINDER).
      whatsappPurpose: item.channel === "WHATSAPP" ? purpose : null,
      whatsappContext: item.channel === "WHATSAPP" ? context : null,
    });

    const savedMessage = await persistNotificationResult({
      preorderId: preorder.id,
      channel: item.channel,
      purpose: persistedPurpose,
      toPhone: item.channel === "EMAIL" ? null : item.to,
      toEmail: item.channel === "EMAIL" ? item.to : null,
      message: messageToSend,
      paymentLinkTarget,
      paymentLinkTracked,
      actorName,
      sendResult,
      events: sendResult.events || [],
    });

    const attempt = {
      channel: item.channel,
      sent: Boolean(sendResult.accepted),
      queued: false,
      to: item.to,
      messageId: savedMessage.id,
      provider: sendResult.provider || null,
      providerMessageId: sendResult.providerMessageId || null,
      errorCode: sendResult.errorCode || null,
      errorMessage: sendResult.errorMessage || null,
    };
    attempts.push(attempt);
    if (sendResult.accepted && !firstSuccess) {
      firstSuccess = {
        channel: item.channel,
        toPhone: item.channel === "EMAIL" ? null : item.to,
        toEmail: item.channel === "EMAIL" ? item.to : null,
        messageId: savedMessage.id,
        provider: sendResult.provider || null,
        providerMessageId: sendResult.providerMessageId || null,
      };
    }

    // WhatsApp refusé immédiatement : secours SMS. Les échecs signalés plus
    // tard par MailerSend passent par queueSmsFallbackForFailedWhatsApp.
    if (item.channel === "WHATSAPP" && !sendResult.accepted && item.smsFallbackTo) {
      const fallbackMessage = await queueSmsNotification({
        preorderId: preorder.id,
        purpose: persistedPurpose,
        toPhone: item.smsFallbackTo,
        message: resolvedSmsMessage,
        paymentLinkTarget,
        paymentLinkTracked,
        actorName,
        maxAttempts: Math.max(1, Number(maxSmsRetries) + 1),
      });
      await prisma.orderMessageEvent.create({
        data: {
          orderMessageId: savedMessage.id,
          status: WHATSAPP_SMS_FALLBACK_EVENT,
          note: `Échec WhatsApp : SMS de secours mis en file (${fallbackMessage.id}).`,
        },
      });
      attempts.push({
        channel: "SMS",
        sent: false,
        queued: true,
        to: item.smsFallbackTo,
        messageId: fallbackMessage.id,
        provider: fallbackMessage.provider || "ORANGE",
        providerMessageId: null,
        errorCode: null,
        errorMessage: null,
        fallbackFrom: "WHATSAPP",
      });
      if (!firstSuccess) {
        firstSuccess = {
          channel: "SMS",
          toPhone: item.smsFallbackTo,
          toEmail: null,
          messageId: fallbackMessage.id,
          provider: fallbackMessage.provider || "ORANGE",
          providerMessageId: null,
        };
      }
    }
  }

  const smsSent = attempts.some((a) => a.channel === "SMS" && a.sent);
  const smsQueued = attempts.some((a) => a.channel === "SMS" && a.queued);
  const whatsappSent = attempts.some((a) => a.channel === "WHATSAPP" && a.sent);
  const emailSent = attempts.some((a) => a.channel === "EMAIL" && a.sent);
  const anyAccepted = attempts.some((a) => a.sent || a.queued);
  const pushResult = await sendPreorderMobilePush({
    preorder,
    purpose: pushPurpose,
    message: resolvedSmsMessage,
  });

  if (anyAccepted) {
    return {
      sent: true,
      skipped: false,
      queued: smsQueued,
      channel: firstSuccess?.channel || null,
      toPhone: firstSuccess?.toPhone || resolvedPhone || null,
      toEmail: firstSuccess?.toEmail || resolvedEmail || null,
      messageId: firstSuccess?.messageId || null,
      provider: firstSuccess?.provider || null,
      providerMessageId: firstSuccess?.providerMessageId || null,
      errorCode: null,
      errorMessage: null,
      attempts,
      push: pushResult,
      smsSent,
      smsQueued,
      whatsappSent,
      emailSent,
    };
  }

  return {
    sent: false,
    skipped: false,
    channel: null,
    toPhone: resolvedPhone,
    toEmail: resolvedEmail,
    messageId: attempts[attempts.length - 1]?.messageId || null,
    provider: attempts[attempts.length - 1]?.provider || null,
    providerMessageId: attempts[attempts.length - 1]?.providerMessageId || null,
    errorCode: attempts[attempts.length - 1]?.errorCode || "NOTIFICATION_FAILED",
    errorMessage:
      attempts[attempts.length - 1]?.errorMessage ||
      "Toutes les tentatives de notification ont échoué.",
    attempts,
    push: pushResult,
    smsSent: false,
    whatsappSent: false,
    emailSent: false,
  };
}

module.exports = {
  resolveNotificationPhone,
  resolveNotificationEmail,
  buildNotificationPrefix,
  prependNotificationPrefix,
  buildPreparationStartedSmsMessage,
  buildPaymentConfirmedSmsMessage,
  buildOrderReadySmsMessage,
  buildOrderFulfilledSmsMessage,
  sendPreorderNotification,
  queueSmsFallbackForFailedWhatsApp,
};
