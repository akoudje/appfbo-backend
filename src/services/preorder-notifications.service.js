const prisma = require("../prisma");
const { sendSms } = require("./sms.service");
const whatsappService = require("./whatsapp.service");
const { normalizeEmail, sendEmail } = require("./email.service");
const { MAX_SMS_LENGTH } = require("./sms.orange.service");

function compactText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstSmsCandidate(candidates = [], maxLength = MAX_SMS_LENGTH) {
  for (const raw of candidates) {
    const candidate = compactText(raw);
    if (!candidate) continue;
    if (candidate.length <= maxLength) return candidate;
  }
  return compactText(candidates[0] || "").slice(0, maxLength);
}

function resolveNotificationPhone(preorder) {
  return (
    preorder?.factureWhatsappTo ||
    preorder?.messages?.find((message) => message?.toPhone)?.toPhone ||
    null
  );
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

  return firstSmsCandidate([
    `Bonjour ${customer}, colis ${parcelNumber} en préparation. Nous vous informons dès qu'il est prêt.`,
    `Colis ${parcelNumber} en préparation. Notification quand il sera prêt.`,
    `Colis ${parcelNumber} en préparation.`,
  ]);
}

function buildOrderReadySmsMessage({ preorder, pickupSecretCode }) {
  const customer = preorder?.fboNomComplet || "";
  const parcelNumber =
    preorder?.parcelNumber || preorder?.preorderNumber || preorder?.id || "-";

  return firstSmsCandidate([
    `Bonjour ${customer}, colis ${parcelNumber} prêt. Code retrait: ${pickupSecretCode}. Présentez-le au comptoir.`,
    `Colis ${parcelNumber} prêt. Code retrait: ${pickupSecretCode}.`,
    `Colis ${parcelNumber} prêt. Code: ${pickupSecretCode}.`,
  ]);
}

function buildOrderFulfilledSmsMessage({ preorder }) {
  const customer = preorder?.fboNomComplet || "";
  const parcelNumber =
    preorder?.parcelNumber || preorder?.preorderNumber || preorder?.id || "-";

  return firstSmsCandidate([
    `Bonjour ${customer}, retrait du colis ${parcelNumber} confirmé. Merci pour votre confiance.`,
    `Retrait du colis ${parcelNumber} confirmé. Merci.`,
  ]);
}

function formatFcfa(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0 FCFA";
  return `${new Intl.NumberFormat("fr-FR").format(Math.max(0, Math.round(num)))} FCFA`;
}

function buildEmailSubjectByPurpose({ purpose, preorder }) {
  const normalizedPurpose = String(purpose || "").trim().toUpperCase();
  const preorderNumber = preorder?.preorderNumber || preorder?.id || "-";

  if (normalizedPurpose === "INVOICE" || normalizedPurpose === "PAYMENT_LINK") {
    return `FOREVER - Facture ${preorderNumber}`;
  }
  if (normalizedPurpose === "ORDER_READY") {
    return `FOREVER - Colis prêt (${preorderNumber})`;
  }
  if (normalizedPurpose === "PREPARATION_STARTED") {
    return `FOREVER - Préparation en cours (${preorderNumber})`;
  }
  if (normalizedPurpose === "PAYMENT_CONFIRMED") {
    return `FOREVER - Paiement confirmé (${preorderNumber})`;
  }
  return `FOREVER - Notification commande (${preorderNumber})`;
}

function buildDefaultEmailBodyByPurpose({
  purpose,
  preorder,
  smsMessage,
  paymentLinkTarget = null,
  paymentLinkTracked = null,
}) {
  const normalizedPurpose = String(purpose || "").trim().toUpperCase();
  const customer = preorder?.fboNomComplet || "Client";
  const preorderNumber = preorder?.preorderNumber || preorder?.id || "-";
  const parcelNumber = preorder?.parcelNumber || preorderNumber;
  const invoiceRef =
    preorder?.factureReference || preorder?.preorderNumber || preorder?.id || "-";
  const total = formatFcfa(preorder?.totalFcfa || preorder?.as400InvoiceTotalFcfa || 0);
  const paymentLink = String(paymentLinkTracked || paymentLinkTarget || "").trim();
  const pickupCode = preorder?.pickupSecretCode || "-";

  if (normalizedPurpose === "INVOICE" || normalizedPurpose === "PAYMENT_LINK") {
    return [
      `Bonjour ${customer},`,
      "",
      "Votre facture est disponible.",
      `Référence: ${invoiceRef}`,
      `Commande: ${preorderNumber}`,
      `Montant à payer: ${total}`,
      paymentLink ? `Lien de paiement: ${paymentLink}` : "Mode de paiement: à la caisse FLP",
      "",
      "Merci de votre confiance.",
      "Equipe FOREVER",
    ].join("\n");
  }

  if (normalizedPurpose === "ORDER_READY") {
    return [
      `Bonjour ${customer},`,
      "",
      `Votre colis ${parcelNumber} est prêt à être retiré.`,
      `Code de retrait: ${pickupCode}`,
      "",
      "Présentez ce code au comptoir lors du retrait.",
      "Equipe FOREVER",
    ].join("\n");
  }

  if (normalizedPurpose === "PREPARATION_STARTED") {
    return [
      `Bonjour ${customer},`,
      "",
      `Votre colis ${parcelNumber} est en cours de préparation.`,
      "Nous vous informerons dès qu'il sera prêt.",
      "",
      "Equipe FOREVER",
    ].join("\n");
  }

  if (normalizedPurpose === "PAYMENT_CONFIRMED") {
    return [
      `Bonjour ${customer},`,
      "",
      `Votre paiement pour la commande ${preorderNumber} a été confirmé.`,
      "",
      "Merci pour votre confiance.",
      "Equipe FOREVER",
    ].join("\n");
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

function normalizePurposeKey(purpose = "") {
  const key = String(purpose || "").trim().toUpperCase();
  if (key === "PAYMENT_LINK") return "INVOICE";
  if (key === "REMINDER") return "REMINDER";
  return key;
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
}) {
  const customerName = preorder?.fboNomComplet || "Client";
  const preorderNumber = preorder?.preorderNumber || preorder?.id || "-";
  const parcelNumber = preorder?.parcelNumber || preorderNumber;
  const invoiceRef =
    preorder?.factureReference || preorder?.preorderNumber || preorder?.id || "-";
  const totalFcfa = Number(
    preorder?.totalFcfa || preorder?.as400InvoiceTotalFcfa || 0,
  );
  const paymentLink = String(paymentLinkTracked || paymentLinkTarget || "").trim();
  const pickupCode = preorder?.pickupSecretCode || "-";

  return {
    purpose: normalizePurposeKey(purpose),
    customerName,
    preorderNumber,
    parcelNumber,
    invoiceRef,
    totalFcfa: String(Math.max(0, Math.round(totalFcfa))),
    totalFcfaLabel: formatFcfa(totalFcfa),
    paymentLink,
    pickupCode,
    supportPhone: supportPhone || "",
    pickupAddress: pickupAddress || "",
  };
}

function resolveConfiguredTemplates({
  templatesRoot,
  purpose,
  context,
  fallbackSms,
  fallbackEmailSubject,
  fallbackEmailBody,
}) {
  const purposeKey = normalizePurposeKey(purpose);

  const smsTemplate = getNestedTemplate(templatesRoot, [
    "sms",
    purposeKey,
  ]);
  const emailSubjectTemplate = getNestedTemplate(templatesRoot, [
    "email",
    purposeKey,
    "subject",
  ]);
  const emailBodyTemplate = getNestedTemplate(templatesRoot, [
    "email",
    purposeKey,
    "body",
  ]);

  const resolvedSms = compactText(
    smsTemplate ? interpolateTemplate(smsTemplate, context) : fallbackSms,
  );
  const resolvedSubject = compactText(
    emailSubjectTemplate
      ? interpolateTemplate(emailSubjectTemplate, context)
      : fallbackEmailSubject,
  );
  const resolvedEmailBody = String(
    emailBodyTemplate
      ? interpolateTemplate(emailBodyTemplate, context)
      : fallbackEmailBody,
  )
    .replace(/\r\n/g, "\n")
    .trim();

  return {
    smsMessage: firstSmsCandidate([resolvedSms || fallbackSms]),
    emailSubject: resolvedSubject || fallbackEmailSubject,
    emailBody: resolvedEmailBody || fallbackEmailBody,
  };
}

async function persistNotificationResult({
  preorderId,
  channel,
  purpose,
  toPhone = null,
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
        ? `Notification ${channel} envoyée.`
        : `Échec de la notification ${channel}.`,
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

async function sendSmsWithRetry({
  to,
  message,
  callbackData,
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
  subject,
  preorderId,
  maxSmsRetries = 2,
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
      maxRetries: maxSmsRetries,
    });
  }

  if (channel === "WHATSAPP") {
    return whatsappService.sendTextMessage({
      to,
      body: message,
      metadata: {
        preorderId,
      },
    });
  }

  if (channel === "EMAIL") {
    return sendEmail({
      to,
      subject: subject || "Notification commande FOREVER",
      body: message,
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
}) {
  if (!preorder?.id || !message) {
    return { sent: false, skipped: true, reason: "INVALID_NOTIFICATION" };
  }

  const resolvedPhone = toPhone || resolveNotificationPhone(preorder);
  const resolvedWhatsapp = toWhatsapp || resolvedPhone;
  const resolvedEmail = resolveNotificationEmail(preorder, toEmail);
  const defaultEmailSubject =
    String(emailSubject || "").trim() ||
    buildEmailSubjectByPurpose({ purpose, preorder });
  const defaultEmailMessage =
    String(emailMessage || "").trim() ||
    buildDefaultEmailBodyByPurpose({
      purpose,
      preorder,
      smsMessage: message,
      paymentLinkTarget,
      paymentLinkTracked,
    });
  const fallbackSmsMessage = firstSmsCandidate([compactText(message || "")]);

  const countryTemplateSettings = await loadCountryNotificationTemplates(
    preorder?.countryId || preorder?.country?.id || null,
  );
  const context = buildTemplateContext({
    preorder,
    purpose,
    paymentLinkTarget,
    paymentLinkTracked,
    supportPhone: countryTemplateSettings?.supportPhone || null,
    pickupAddress: countryTemplateSettings?.pickupAddress || null,
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

  const hasSmsIntent = Boolean(resolvedPhone);
  const channels = hasSmsIntent
    ? [
        { channel: "SMS", to: resolvedPhone },
        { channel: "EMAIL", to: resolvedEmail },
      ]
    : [
        { channel: "WHATSAPP", to: resolvedWhatsapp },
        { channel: "EMAIL", to: resolvedEmail },
      ];

  if (!resolvedPhone && !resolvedWhatsapp && !resolvedEmail) {
    return { sent: false, skipped: true, reason: "NO_DESTINATION" };
  }

  const attempts = [];
  let firstSuccess = null;
  for (const item of channels) {
    if (!item.to) continue;

    const sendResult = await sendByChannel({
      channel: item.channel,
      to: item.to,
      message: item.channel === "EMAIL" ? resolvedEmailMessage : resolvedSmsMessage,
      subject: item.channel === "EMAIL" ? resolvedEmailSubject : undefined,
      preorderId: preorder.id,
      maxSmsRetries,
    });

    const savedMessage = await persistNotificationResult({
      preorderId: preorder.id,
      channel: item.channel,
      purpose,
      toPhone: item.channel === "EMAIL" ? null : item.to,
      message:
        item.channel === "EMAIL" ? resolvedEmailMessage : resolvedSmsMessage,
      paymentLinkTarget,
      paymentLinkTracked,
      actorName,
      sendResult,
      events: sendResult.events || [],
    });

    const attempt = {
      channel: item.channel,
      sent: Boolean(sendResult.accepted),
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
  }

  const smsSent = attempts.some((a) => a.channel === "SMS" && a.sent);
  const whatsappSent = attempts.some((a) => a.channel === "WHATSAPP" && a.sent);
  const emailSent = attempts.some((a) => a.channel === "EMAIL" && a.sent);
  const anySent = attempts.some((a) => a.sent);

  if (anySent) {
    return {
      sent: true,
      skipped: false,
      channel: firstSuccess?.channel || null,
      toPhone: firstSuccess?.toPhone || resolvedPhone || null,
      toEmail: firstSuccess?.toEmail || resolvedEmail || null,
      messageId: firstSuccess?.messageId || null,
      provider: firstSuccess?.provider || null,
      providerMessageId: firstSuccess?.providerMessageId || null,
      errorCode: null,
      errorMessage: null,
      attempts,
      smsSent,
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
    smsSent: false,
    whatsappSent: false,
    emailSent: false,
  };
}

module.exports = {
  resolveNotificationPhone,
  resolveNotificationEmail,
  buildPreparationStartedSmsMessage,
  buildOrderReadySmsMessage,
  buildOrderFulfilledSmsMessage,
  sendPreorderNotification,
};
