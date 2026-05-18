const prisma = require("../prisma");

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function isValidExpoPushToken(token = "") {
  return /^(ExpoPushToken|ExponentPushToken)\[[^\]]+\]$/.test(String(token || "").trim());
}

function canonicalFboNumber(raw = "") {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 12) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9, 12)}`;
  }
  return String(raw || "").trim();
}

function notificationKeyForPurpose(preorderId, purpose = "") {
  const normalizedPurpose = String(purpose || "").trim().toUpperCase();
  const suffixByPurpose = {
    INVOICE: "payment-due",
    PAYMENT_LINK: "payment-due",
    REMINDER: "payment-due",
    PAYMENT_CONFIRMED: "paid",
    ORDER_READY: "ready",
    ORDER_FULFILLED: "fulfilled",
    PREPARATION_STARTED: "preparation-started",
  };
  return `${preorderId}:${suffixByPurpose[normalizedPurpose] || normalizedPurpose.toLowerCase() || "update"}`;
}

function titleForPurpose(purpose = "") {
  const normalizedPurpose = String(purpose || "").trim().toUpperCase();
  const titles = {
    INVOICE: "Préfacture disponible",
    PAYMENT_LINK: "Paiement disponible",
    REMINDER: "Rappel de paiement",
    PAYMENT_CONFIRMED: "Paiement confirmé",
    PREPARATION_STARTED: "Préparation lancée",
    ORDER_READY: "Commande prête",
    ORDER_FULFILLED: "Commande clôturée",
  };
  return titles[normalizedPurpose] || "Mise à jour commande";
}

function compactBody(message = "") {
  const body = String(message || "").replace(/\s+/g, " ").trim();
  if (!body) return "Votre commande FOREVER a été mise à jour.";
  return body.length > 180 ? `${body.slice(0, 177)}...` : body;
}

async function resolveRecipientFboIds(preorder = {}) {
  const ids = new Set();
  if (preorder?.fboId) ids.add(preorder.fboId);

  const placedByNumero = canonicalFboNumber(preorder?.placedByFboNumero || "");
  if (placedByNumero && placedByNumero !== canonicalFboNumber(preorder?.fboNumero || "")) {
    const initiator = await prisma.fbo.findUnique({
      where: { numeroFbo: placedByNumero },
      select: { id: true },
    });
    if (initiator?.id) ids.add(initiator.id);
  }

  return [...ids];
}

async function sendExpoPushBatch(messages) {
  if (!messages.length || typeof fetch !== "function") {
    return { accepted: false, skipped: true, reason: "NO_MESSAGES_OR_FETCH" };
  }

  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });

  const payload = await response.json().catch(() => null);
  return {
    accepted: response.ok,
    status: response.status,
    rawPayload: payload,
  };
}

async function sendPreorderMobilePush({
  preorder,
  purpose,
  message,
  title = null,
}) {
  try {
    if (!preorder?.id) {
      return { sent: false, skipped: true, reason: "NO_PREORDER" };
    }

    const recipientFboIds = await resolveRecipientFboIds(preorder);
    if (!recipientFboIds.length) {
      return { sent: false, skipped: true, reason: "NO_RECIPIENT_FBO" };
    }

    const tokens = await prisma.mobilePushToken.findMany({
      where: {
        enabled: true,
        fboId: { in: recipientFboIds },
      },
      select: {
        token: true,
      },
    });

    const validTokens = [...new Set(tokens.map((row) => row.token).filter(isValidExpoPushToken))];
    if (!validTokens.length) {
      return { sent: false, skipped: true, reason: "NO_PUSH_TOKEN" };
    }

    const notificationKey = notificationKeyForPurpose(preorder.id, purpose);
    const data = {
      type: "ORDER_STATUS",
      screen: "OrderDetail",
      orderId: preorder.id,
      preorderId: preorder.id,
      preorderNumber: preorder.preorderNumber || "",
      notificationKey,
      purpose: String(purpose || "").trim().toUpperCase(),
    };

    const messages = validTokens.map((to) => ({
      to,
      title: title || titleForPurpose(purpose),
      body: compactBody(message),
      data,
      sound: "default",
      channelId:
        ["INVOICE", "PAYMENT_LINK", "REMINDER"].includes(String(purpose || "").toUpperCase())
          ? "payment-reminders"
          : "preorder-updates",
    }));

    const result = await sendExpoPushBatch(messages);
    return {
      sent: Boolean(result.accepted),
      skipped: false,
      tokenCount: validTokens.length,
      notificationKey,
      ...result,
    };
  } catch (error) {
    console.warn("[mobile-push] sendPreorderMobilePush failed", {
      preorderId: preorder?.id || null,
      message: error?.message || String(error),
    });
    return {
      sent: false,
      skipped: false,
      errorMessage: error?.message || String(error),
    };
  }
}

module.exports = {
  sendPreorderMobilePush,
  notificationKeyForPurpose,
};
