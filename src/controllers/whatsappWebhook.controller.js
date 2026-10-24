const crypto = require("crypto");
const prisma = require("../prisma");

// MailerSend WhatsApp webhook: chaque sender a son propre secret de
// signature, révélé dans le dashboard (WhatsApp -> Phone numbers -> sender ->
// Webhooks). Même convention que wave.provider.js: HMAC-SHA256 hex sur le
// corps brut, comparaison en temps constant.
// https://developers.mailersend.com/api/v1/whatsapp/webhooks
function isSignatureValid(req) {
  const secret = String(process.env.MAILERSEND_WHATSAPP_WEBHOOK_SECRET || "").trim();
  if (!secret) return false;

  const rawBody = req.rawBody || "";
  if (!rawBody) return false;

  const signatureHeader = String(req.get("Signature") || "").trim();
  if (!signatureHeader) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}

function mapWhatsAppEventToMessageStatus(dataType = "") {
  const t = String(dataType || "").trim().toLowerCase();
  if (t === "sent") return "SENT";
  if (t === "delivered") return "DELIVERED";
  if (t === "read") return "READ";
  if (t === "failed") return "FAILED";
  return null;
}

async function findOrderMessageByWhatsAppMessageId(whatsappMessageId) {
  if (!whatsappMessageId) return null;
  return prisma.orderMessage.findFirst({
    where: { channel: "WHATSAPP", providerMessageId: String(whatsappMessageId) },
  });
}

async function mailerSendWhatsAppEventsWebhook(req, res) {
  if (!isSignatureValid(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized webhook" });
  }

  try {
    const event = req.body || {};
    const eventType = String(event?.type || "").trim();

    // Les messages entrants (réponses du client) ne correspondent à aucun
    // envoi sortant — on les journalise simplement pour l'instant, sans les
    // rattacher à un OrderMessage.
    if (eventType === "whatsapp.inbound") {
      console.log("[whatsapp][mailersend][webhook] inbound message", {
        from: event?.data?.from || null,
        type: event?.data?.type || null,
      });
      return res.status(200).json({ ok: true, inbound: true });
    }

    const data = event?.data || {};
    const mappedStatus = mapWhatsAppEventToMessageStatus(data?.type);
    const message = await findOrderMessageByWhatsAppMessageId(data?.whatsapp_message_id);

    if (!message) {
      return res.status(200).json({ ok: true, processed: 0, unresolved: 1 });
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      if (mappedStatus) {
        await tx.orderMessage.update({
          where: { id: message.id },
          data: {
            status: mappedStatus,
            lastStatusAt: now,
            deliveredAt: mappedStatus === "DELIVERED" ? message.deliveredAt || now : message.deliveredAt,
            readAt: mappedStatus === "READ" ? message.readAt || now : message.readAt,
            failedAt: mappedStatus === "FAILED" ? message.failedAt || now : message.failedAt,
            errorCode: mappedStatus === "FAILED" ? String(data?.meta?.error_code || "WHATSAPP_FAILED") : null,
            errorMessage:
              mappedStatus === "FAILED"
                ? data?.meta?.error_title || data?.meta?.error_message || "Échec d'envoi WhatsApp."
                : null,
          },
        });
      }

      await tx.orderMessageEvent.create({
        data: {
          orderMessageId: message.id,
          status: mappedStatus || "INFO",
          rawPayload: event || null,
          note: `MailerSend WhatsApp webhook: ${eventType || "unknown"}.`,
        },
      });
    });

    return res.status(200).json({ ok: true, processed: 1 });
  } catch (error) {
    console.error("[whatsapp][mailersend][webhook] error", error);
    return res.status(500).json({ ok: false, error: error.message || "Erreur webhook WhatsApp MailerSend" });
  }
}

module.exports = {
  mailerSendWhatsAppEventsWebhook,
};
