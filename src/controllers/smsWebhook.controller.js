const prisma = require("../prisma");
const { mapOrangeDeliveryStatus } = require("../services/sms.service");

function pickString(values = []) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function extractRequestId(value = "") {
  const s = String(value || "");
  const match = s.match(/\/requests\/([^/?#]+)/i);
  return match?.[1] || null;
}

function mapDeliveryToPersistedStatus(deliveryStatus) {
  if (deliveryStatus === "delivered") return "DELIVERED";
  if (deliveryStatus === "failed") return "FAILED";
  if (deliveryStatus === "pending") return "SENT";
  return null;
}

function mapDeliveryToMessageStatus(deliveryStatus) {
  if (deliveryStatus === "delivered") return "DELIVERED";
  if (deliveryStatus === "failed") return "FAILED";
  if (deliveryStatus === "pending") return "SENT";
  return null;
}

function readCallbackPreorderId(rawCallbackData) {
  if (!rawCallbackData) return null;
  const txt = String(rawCallbackData).trim();
  if (!txt) return null;

  if (txt.startsWith("{") && txt.endsWith("}")) {
    try {
      const parsed = JSON.parse(txt);
      if (typeof parsed?.preorderId === "string" && parsed.preorderId.trim()) {
        return parsed.preorderId.trim();
      }
    } catch (e) {
      // ignore malformed json callbackData
    }
  }

  return txt;
}

function readCallbackExternalLinkId(rawCallbackData) {
  const txt = String(rawCallbackData || "").trim();
  if (!txt) return null;

  if (txt.startsWith("{") && txt.endsWith("}")) {
    try {
      const parsed = JSON.parse(txt);
      if (typeof parsed?.externalLinkId === "string" && parsed.externalLinkId.trim()) {
        return parsed.externalLinkId.trim();
      }
    } catch (e) {
      // ignore malformed json callbackData
    }
  }

  const match = txt.match(/^external-link-(.+)$/i);
  return match?.[1] || null;
}

// Identifiant Orange d'un envoi (fin de resourceURL ".../requests/<id>").
function looksLikeOrangeRequestId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

// Format Orange Afrique (developer.orange.com, SMS API) :
// { deliveryInfoNotification: { callbackData: "<resource_id>",
//   deliveryInfo: { address: "tel:+225…", deliveryStatus: "DeliveredToTerminal" } } }
// callbackData y est l'identifiant Orange de l'envoi, pas le nôtre : l'URL de
// retour est enregistrée une fois chez Orange, le receiptRequest par message
// est ignoré.
function parseOrangeDeliveryPayload(body = {}) {
  const notification = body?.deliveryInfoNotification || body?.deliveryReceiptNotification || null;
  const deliveryStatusRaw = pickString([
    notification?.deliveryInfo?.deliveryStatus,
    body?.deliveryInfoList?.deliveryInfo?.[0]?.deliveryStatus,
    body?.outboundSMSMessageRequest?.deliveryInfoList?.deliveryInfo?.[0]
      ?.deliveryStatus,
    body?.deliveryStatus,
    body?.status,
  ]);

  const providerMessageId = pickString([
    notification?.resourceURL,
    body?.outboundSMSMessageRequest?.resourceURL,
    body?.resourceURL,
    body?.resourceUrl,
  ]);

  const rawCallbackData = pickString([
    notification?.callbackData,
    body?.outboundSMSMessageRequest?.receiptRequest?.callbackData,
    body?.callbackData,
  ]);

  const requestId = pickString([
    extractRequestId(providerMessageId),
    looksLikeOrangeRequestId(rawCallbackData) ? rawCallbackData : null,
    notification?.messageId,
    body?.messageId,
    body?.id,
  ]);

  const callbackData = readCallbackPreorderId(rawCallbackData);

  const recipient = pickString([
    notification?.deliveryInfo?.address,
    body?.deliveryInfoList?.deliveryInfo?.[0]?.address,
    body?.address,
  ]);

  return {
    providerStatus: deliveryStatusRaw,
    deliveryStatus: mapOrangeDeliveryStatus(deliveryStatusRaw),
    providerMessageId,
    requestId,
    callbackData,
    recipient,
    rawPayload: body,
  };
}

function isWebhookAuthorized(req) {
  const expectedToken = String(process.env.ORANGE_WEBHOOK_TOKEN || "").trim();
  if (!expectedToken) return false;

  const headerToken =
    req.get("x-webhook-token") || req.get("x-orange-webhook-token") || "";
  const queryToken = String(req.query?.token || "").trim();
  return expectedToken === headerToken || expectedToken === queryToken;
}

function logUnauthorizedWebhook(req) {
  console.warn("[sms][orange][webhook] unauthorized", {
    method: req.method,
    path: req.originalUrl || req.url,
    hasExpectedToken: Boolean(String(process.env.ORANGE_WEBHOOK_TOKEN || "").trim()),
    hasHeaderToken: Boolean(
      req.get("x-webhook-token") || req.get("x-orange-webhook-token"),
    ),
    hasQueryToken: Boolean(String(req.query?.token || "").trim()),
    contentType: req.get("content-type") || null,
    userAgent: req.get("user-agent") || null,
    bodyKeys:
      req.body && typeof req.body === "object" ? Object.keys(req.body).slice(0, 10) : [],
  });
}

// SMS de commande visé par l'accusé, retrouvé par l'identifiant Orange de
// l'envoi (providerMessageId = resourceURL ".../requests/<id>"). Les accusés
// arrivent dans les 24 h : la recherche est bornée aux envois récents.
async function findOrderMessageForDelivery(parsed) {
  if (!parsed.requestId) return null;
  return prisma.orderMessage.findFirst({
    where: {
      channel: "SMS",
      provider: "ORANGE",
      providerMessageId: { endsWith: `/requests/${parsed.requestId}` },
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function findPreorderForDelivery(parsed) {
  if (parsed.callbackData) {
    const byId = await prisma.preorder.findUnique({
      where: { id: parsed.callbackData },
      select: { id: true },
    });
    if (byId) return byId;
  }

  if (parsed.providerMessageId) {
    const byExactMessageId = await prisma.preorder.findFirst({
      where: { lastWhatsappMessageId: parsed.providerMessageId },
      select: { id: true },
    });
    if (byExactMessageId) return byExactMessageId;
  }

  if (parsed.requestId) {
    const byRequestIdSuffix = await prisma.preorder.findFirst({
      where: {
        lastWhatsappMessageId: {
          endsWith: `/requests/${parsed.requestId}`,
        },
      },
      select: { id: true },
    });
    if (byRequestIdSuffix) return byRequestIdSuffix;
  }

  return null;
}

async function findExternalPaymentLinkForDelivery(parsed) {
  const callbackExternalLinkId = readCallbackExternalLinkId(parsed.callbackData);
  if (callbackExternalLinkId) {
    const byId = await prisma.externalPaymentLink.findUnique({
      where: { id: callbackExternalLinkId },
      select: { id: true },
    });
    if (byId) return byId;
  }

  if (parsed.providerMessageId) {
    const byExactMessageId = await prisma.externalPaymentLink.findFirst({
      where: { smsProviderMessageId: parsed.providerMessageId },
      select: { id: true },
    });
    if (byExactMessageId) return byExactMessageId;
  }

  if (parsed.requestId) {
    const byRequestIdSuffix = await prisma.externalPaymentLink.findFirst({
      where: {
        smsProviderMessageId: {
          endsWith: `/requests/${parsed.requestId}`,
        },
      },
      select: { id: true },
    });
    if (byRequestIdSuffix) return byRequestIdSuffix;
  }

  return null;
}

async function updateExternalPaymentLinkDelivery({ parsed, link }) {
  const deliveryStatus = parsed.deliveryStatus;
  const now = new Date();
  const smsStatus =
    deliveryStatus === "delivered"
      ? "DELIVERED"
      : deliveryStatus === "failed"
        ? "FAILED"
        : "SENT";

  await prisma.externalPaymentLink.update({
    where: { id: link.id },
    data: {
      smsStatus,
      smsProviderMessageId: parsed.providerMessageId || undefined,
      smsLastError:
        deliveryStatus === "failed"
          ? parsed.providerStatus || "Échec de distribution SMS"
          : null,
      smsLastSentAt: now,
    },
  });

  console.log("[sms][orange][webhook] external link delivery updated", {
    externalPaymentLinkId: link.id,
    smsStatus,
    providerStatus: parsed.providerStatus,
    providerMessageId: parsed.providerMessageId,
    requestId: parsed.requestId,
  });
}

async function orangeSmsDlrWebhook(req, res) {
  if (!isWebhookAuthorized(req)) {
    logUnauthorizedWebhook(req);
    return res.status(401).json({ ok: false, error: "Unauthorized webhook" });
  }

  try {
    const parsed = parseOrangeDeliveryPayload(req.body || {});
    const matchedMessage = await findOrderMessageForDelivery(parsed);
    const preorder = matchedMessage
      ? { id: matchedMessage.preorderId }
      : await findPreorderForDelivery(parsed);

    if (!preorder) {
      const externalPaymentLink = await findExternalPaymentLinkForDelivery(parsed);
      if (externalPaymentLink) {
        await updateExternalPaymentLinkDelivery({
          parsed,
          link: externalPaymentLink,
        });
        return res.status(200).json({
          ok: true,
          resolved: true,
          type: "externalPaymentLink",
          externalPaymentLinkId: externalPaymentLink.id,
        });
      }

      console.warn("[sms][orange][webhook] message unresolved", {
        providerMessageId: parsed.providerMessageId,
        requestId: parsed.requestId,
        callbackData: parsed.callbackData,
        providerStatus: parsed.providerStatus,
      });
      return res.status(200).json({
        ok: true,
        resolved: false,
      });
    }

    const persistedStatus = mapDeliveryToPersistedStatus(parsed.deliveryStatus);
    const messageStatus = mapDeliveryToMessageStatus(parsed.deliveryStatus);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      let relatedMessage = matchedMessage;

      if (!relatedMessage) {
        relatedMessage = await tx.orderMessage.findFirst({
          where: {
            preorderId: preorder.id,
            channel: "SMS",
            ...(parsed.providerMessageId
              ? { providerMessageId: parsed.providerMessageId }
              : {}),
          },
          orderBy: { createdAt: "desc" },
        });
      }

      if (!relatedMessage) {
        relatedMessage = await tx.orderMessage.findFirst({
          where: {
            preorderId: preorder.id,
            channel: "SMS",
          },
          orderBy: { createdAt: "desc" },
        });
      }

      // Statut SMS de la commande : seulement pour son dernier SMS (un accusé
      // tardif d'un ancien SMS ne doit pas l'écraser).
      const current = await tx.preorder.findUnique({
        where: { id: preorder.id },
        select: { lastWhatsappMessageId: true },
      });
      const isLatestSms =
        !matchedMessage ||
        !current?.lastWhatsappMessageId ||
        current.lastWhatsappMessageId === matchedMessage.providerMessageId;

      // Un accusé intermédiaire arrivé en retard (remis à l'opérateur) ne fait
      // pas repasser un SMS livré ou en échec à "envoyé".
      const isFinal = ["DELIVERED", "READ", "FAILED"].includes(relatedMessage?.status);
      const nextStatus = messageStatus === "SENT" && isFinal ? null : messageStatus;

      if (isLatestSms && (nextStatus || !relatedMessage)) {
        await tx.preorder.update({
          where: { id: preorder.id },
          data: {
            lastWhatsappStatus: persistedStatus || parsed.providerStatus || "SENT",
            lastWhatsappStatusAt: now,
            lastWhatsappMessageId:
              parsed.providerMessageId || undefined,
          },
        });
      }

      if (relatedMessage) {
        await tx.orderMessageEvent.create({
          data: {
            orderMessageId: relatedMessage.id,
            status: messageStatus || parsed.deliveryStatus || "unknown",
            rawPayload: parsed.rawPayload || null,
            note: `Webhook Orange: ${parsed.providerStatus || parsed.deliveryStatus || "unknown"}`,
          },
        });
      }

      if (relatedMessage && nextStatus) {
        await tx.orderMessage.update({
          where: { id: relatedMessage.id },
          data: {
            status: nextStatus,
            lastStatusAt: now,
            deliveredAt:
              messageStatus === "DELIVERED"
                ? relatedMessage.deliveredAt || now
                : relatedMessage.deliveredAt,
            failedAt:
              messageStatus === "FAILED"
                ? relatedMessage.failedAt || now
                : relatedMessage.failedAt,
            errorCode: messageStatus === "FAILED" ? "SMS_DELIVERY_FAILED" : null,
            errorMessage:
              messageStatus === "FAILED"
                ? parsed.providerStatus || "Échec de distribution SMS"
                : null,
          },
        });
      }

      // Historique de la commande : seulement l'issue (livré / échec), pas
      // les étapes intermédiaires (remis à l'opérateur, en attente).
      if (["delivered", "failed"].includes(parsed.deliveryStatus)) await tx.preorderLog.create({
        data: {
          preorderId: preorder.id,
          action: "PAYMENT_PENDING",
          note: "Mise à jour statut SMS (webhook Orange)",
          meta: {
            smsStatus: parsed.deliveryStatus,
            smsProviderStatus: parsed.providerStatus,
            smsMessageId: parsed.providerMessageId,
            smsRequestId: parsed.requestId,
            smsRecipient: parsed.recipient,
          },
        },
      });
    });

    console.log("[sms][orange][webhook] delivery updated", {
      preorderId: preorder.id,
      smsStatus: parsed.deliveryStatus,
      providerStatus: parsed.providerStatus,
      providerMessageId: parsed.providerMessageId,
      requestId: parsed.requestId,
    });

    return res.status(200).json({
      ok: true,
      resolved: true,
      preorderId: preorder.id,
    });
  } catch (e) {
    console.error("[sms][orange][webhook] error", e);
    return res.status(500).json({
      ok: false,
      error: e.message || "Erreur webhook SMS Orange",
    });
  }
}

function orangeSmsDlrWebhookProbe(req, res) {
  if (!isWebhookAuthorized(req)) {
    logUnauthorizedWebhook(req);
    return res.status(401).json({ ok: false, error: "Unauthorized webhook" });
  }

  console.log("[sms][orange][webhook] probe ok", {
    method: req.method,
    path: req.originalUrl || req.url,
    userAgent: req.get("user-agent") || null,
  });

  return res.status(200).json({
    ok: true,
    webhook: "orange-sms-dlr",
  });
}

module.exports = {
  orangeSmsDlrWebhook,
  orangeSmsDlrWebhookProbe,
  parseOrangeDeliveryPayload,
};
