const prisma = require("../prisma");
const { sendSms } = require("./sms.service");

function resolveNotificationPhone(preorder) {
  return (
    preorder?.factureWhatsappTo ||
    preorder?.messages?.find((message) => message?.toPhone)?.toPhone ||
    null
  );
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

async function persistNotificationResult({
  preorderId,
  purpose,
  toPhone,
  message,
  actorName,
  sendResult,
}) {
  const now = new Date();
  const finalMessageStatus = sendResult.accepted ? "SENT" : "FAILED";

  const createdMessage = await prisma.orderMessage.create({
    data: {
      preorderId,
      purpose,
      status: "QUEUED",
      toPhone,
      provider: "ORANGE",
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
        ? "Notification SMS envoyée."
        : "Échec de la notification SMS.",
    },
  });

  return savedMessage;
}

async function sendPreorderNotification({
  preorder,
  purpose,
  message,
  actorName = "SYSTEM",
}) {
  if (!preorder?.id || !message) {
    return { sent: false, skipped: true, reason: "INVALID_NOTIFICATION" };
  }

  const toPhone = resolveNotificationPhone(preorder);

  if (!toPhone) {
    return { sent: false, skipped: true, reason: "NO_DESTINATION" };
  }

  const sendResult = await sendSms({
    to: toPhone,
    message,
    callbackData: preorder.id,
  });

  const savedMessage = await persistNotificationResult({
    preorderId: preorder.id,
    purpose,
    toPhone,
    message,
    actorName,
    sendResult,
  });

  return {
    sent: Boolean(sendResult.accepted),
    skipped: false,
    toPhone,
    messageId: savedMessage.id,
    providerMessageId: savedMessage.providerMessageId || null,
    errorCode: sendResult.errorCode || null,
    errorMessage: sendResult.errorMessage || null,
  };
}

module.exports = {
  resolveNotificationPhone,
  buildPreparationStartedSmsMessage,
  buildOrderReadySmsMessage,
  sendPreorderNotification,
};
