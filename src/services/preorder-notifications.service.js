const prisma = require("../prisma");
const { sendSms } = require("./sms.service");
const whatsappService = require("./whatsapp.service");
const { normalizeEmail, sendEmail } = require("./email.service");

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

  return [
    `Bonjour ${customer},`,
    `Votre colis N° ${parcelNumber} est en cours de préparation.`,
    "Nous vous informerons dès qu'il sera prêt à être retiré.",
  ].join(" ");
}

function buildOrderReadySmsMessage({ preorder, pickupSecretCode }) {
  const customer = preorder?.fboNomComplet || "";
  const parcelNumber =
    preorder?.parcelNumber || preorder?.preorderNumber || preorder?.id || "-";

  return [
    `Bonjour ${customer},`,
    `Votre colis N° ${parcelNumber} est prêt à être retiré.`,
    `Code secret: ${pickupSecretCode}.`,
    "Présentez ce code au comptoir pour retirer votre colis en toute sécurité.",
  ].join(" ");
}

function buildOrderFulfilledSmsMessage({ preorder }) {
  const customer = preorder?.fboNomComplet || "";
  const parcelNumber =
    preorder?.parcelNumber || preorder?.preorderNumber || preorder?.id || "-";

  return [
    `Bonjour ${customer},`,
    `Le retrait de votre colis N° ${parcelNumber} a été confirmé.`,
    "Merci pour votre confiance.",
  ].join(" ");
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
  const channels = [
    { channel: "SMS", to: resolvedPhone },
    { channel: "WHATSAPP", to: resolvedWhatsapp },
    { channel: "EMAIL", to: resolvedEmail },
  ];

  if (!resolvedPhone && !resolvedWhatsapp && !resolvedEmail) {
    return { sent: false, skipped: true, reason: "NO_DESTINATION" };
  }

  const attempts = [];
  for (const item of channels) {
    if (!item.to) continue;

    const sendResult = await sendByChannel({
      channel: item.channel,
      to: item.to,
      message,
      preorderId: preorder.id,
      maxSmsRetries,
    });

    const savedMessage = await persistNotificationResult({
      preorderId: preorder.id,
      channel: item.channel,
      purpose,
      toPhone: item.channel === "EMAIL" ? null : item.to,
      message,
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

    if (sendResult.accepted) {
      return {
        sent: true,
        skipped: false,
        channel: item.channel,
        toPhone: item.channel === "EMAIL" ? null : item.to,
        toEmail: item.channel === "EMAIL" ? item.to : null,
        messageId: savedMessage.id,
        provider: sendResult.provider || null,
        providerMessageId: sendResult.providerMessageId || null,
        errorCode: null,
        errorMessage: null,
        attempts,
      };
    }
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
