// backend/src/controllers/whatsappWebhook.controller.js
// Webhook Meta Cloud API : statuts asynchrones (sent/delivered/read/failed)
// pour les messages envoyés via whatsapp.service.js (sendTemplateMessage).
// Deux endpoints : la poignée de main GET exigée par Meta à la configuration
// du webhook dans le WhatsApp Manager, et le callback POST des statuts.

const crypto = require("crypto");
const prisma = require("../prisma");
const { mapProviderStatus } = require("../services/whatsapp.service");

// GET /webhooks/whatsapp/status — Meta appelle ce endpoint avec hub.mode,
// hub.verify_token et hub.challenge lors de l'activation du webhook ; il
// faut renvoyer hub.challenge tel quel si le token correspond.
function whatsappWebhookVerify(req, res) {
  const expectedToken = String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "").trim();
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (!expectedToken || mode !== "subscribe" || token !== expectedToken) {
    return res.status(403).json({ ok: false, error: "Unauthorized webhook verification" });
  }

  return res.status(200).send(String(challenge || ""));
}

// Même idiome que la vérification Wave (payments/providers/wave.provider.js) :
// HMAC-SHA256 du corps brut comparé en temps constant. Meta signe avec
// WHATSAPP_APP_SECRET au format "X-Hub-Signature-256: sha256=<hex>".
function isSignatureValid(req) {
  const appSecret = String(process.env.WHATSAPP_APP_SECRET || "").trim();
  if (!appSecret) return false;

  const header = String(req.get("x-hub-signature-256") || "").trim();
  const received = header.startsWith("sha256=") ? header.slice(7) : header;
  if (!received) return false;

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(req.rawBody || "")
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function extractStatusEntries(body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  const statuses = [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const items = Array.isArray(change?.value?.statuses) ? change.value.statuses : [];
      statuses.push(...items);
    }
  }
  return statuses;
}

// POST /webhooks/whatsapp/status
async function whatsappStatusWebhook(req, res) {
  if (!isSignatureValid(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized webhook" });
  }

  try {
    const statuses = extractStatusEntries(req.body || {});
    if (!statuses.length) {
      return res.status(200).json({ ok: true, received: 0, processed: 0 });
    }

    let processed = 0;
    let unresolved = 0;

    for (const item of statuses) {
      const providerMessageId = String(item?.id || "").trim();
      const providerStatus = String(item?.status || "").trim();
      const mappedStatus = mapProviderStatus(providerStatus);
      const now = new Date();

      if (!providerMessageId) {
        unresolved += 1;
        continue;
      }

      // providerMessageId est @unique sur OrderMessage (l'id WhatsApp
      // (wamid...) retourné par l'API est un vrai identifiant 1:1,
      // contrairement à Orange/MailerSend qui ont besoin de repli).
      const message = await prisma.orderMessage.findUnique({
        where: { providerMessageId },
      });
      if (!message) {
        unresolved += 1;
        continue;
      }

      const errorDetail = Array.isArray(item?.errors) ? item.errors[0] : null;

      await prisma.$transaction(async (tx) => {
        await tx.orderMessage.update({
          where: { id: message.id },
          data: {
            status: mappedStatus,
            lastStatusAt: now,
            sentAt: mappedStatus === "SENT" ? message.sentAt || now : message.sentAt,
            deliveredAt:
              mappedStatus === "DELIVERED" ? message.deliveredAt || now : message.deliveredAt,
            readAt: mappedStatus === "READ" ? message.readAt || now : message.readAt,
            failedAt: mappedStatus === "FAILED" ? message.failedAt || now : message.failedAt,
            errorCode:
              mappedStatus === "FAILED"
                ? String(errorDetail?.code || "WHATSAPP_DELIVERY_FAILED")
                : null,
            errorMessage:
              mappedStatus === "FAILED"
                ? errorDetail?.title || errorDetail?.message || "Échec de livraison WhatsApp"
                : null,
          },
        });

        await tx.orderMessageEvent.create({
          data: {
            orderMessageId: message.id,
            status: mappedStatus,
            rawPayload: item || null,
            note: `Webhook WhatsApp: ${providerStatus || "unknown"}`,
          },
        });
      });

      processed += 1;
    }

    return res.status(200).json({ ok: true, received: statuses.length, processed, unresolved });
  } catch (error) {
    console.error("[whatsapp][webhook] error", error);
    return res.status(500).json({ ok: false, error: error.message || "Erreur webhook WhatsApp" });
  }
}

module.exports = {
  whatsappWebhookVerify,
  whatsappStatusWebhook,
};
