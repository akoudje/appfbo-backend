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

function parseOrangeDeliveryPayload(body = {}) {
  const deliveryStatusRaw = pickString([
    body?.deliveryReceiptNotification?.deliveryInfo?.deliveryStatus,
    body?.deliveryInfoList?.deliveryInfo?.[0]?.deliveryStatus,
    body?.outboundSMSMessageRequest?.deliveryInfoList?.deliveryInfo?.[0]
      ?.deliveryStatus,
    body?.deliveryStatus,
    body?.status,
  ]);

  const providerMessageId = pickString([
    body?.deliveryReceiptNotification?.resourceURL,
    body?.outboundSMSMessageRequest?.resourceURL,
    body?.resourceURL,
    body?.resourceUrl,
  ]);

  const requestId = pickString([
    extractRequestId(providerMessageId),
    body?.deliveryReceiptNotification?.messageId,
    body?.messageId,
    body?.id,
  ]);

  const callbackData = readCallbackPreorderId(
    pickString([
      body?.deliveryReceiptNotification?.callbackData,
      body?.outboundSMSMessageRequest?.receiptRequest?.callbackData,
      body?.callbackData,
    ]),
  );

  const recipient = pickString([
    body?.deliveryReceiptNotification?.deliveryInfo?.address,
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
  if (!expectedToken) return true;

  const headerToken =
    req.get("x-webhook-token") || req.get("x-orange-webhook-token") || "";
  const queryToken = String(req.query?.token || "");
  return expectedToken === headerToken || expectedToken === queryToken;
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

async function orangeSmsDlrWebhook(req, res) {
  if (!isWebhookAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized webhook" });
  }

  try {
    const parsed = parseOrangeDeliveryPayload(req.body || {});
    const preorder = await findPreorderForDelivery(parsed);

    if (!preorder) {
      console.warn("[sms][orange][webhook] preorder unresolved", {
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
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.preorder.update({
        where: { id: preorder.id },
        data: {
          lastWhatsappStatus: persistedStatus || parsed.providerStatus || "SENT",
          lastWhatsappStatusAt: now,
          lastWhatsappMessageId:
            parsed.providerMessageId || undefined,
        },
      });

      await tx.preorderLog.create({
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

module.exports = {
  orangeSmsDlrWebhook,
};
