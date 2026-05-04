const prisma = require("../prisma");

function pickString(values = []) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function isWebhookAuthorized(req) {
  const expectedToken = String(process.env.MAILERSEND_WEBHOOK_TOKEN || "").trim();
  if (!expectedToken) return false;

  const headerToken =
    req.get("x-mailersend-signature") ||
    req.get("x-webhook-token") ||
    (req.get("authorization") || "").replace(/^Bearer\s+/i, "");

  return expectedToken === headerToken.trim();
}

function normalizeProviderMessageId(value = "") {
  return String(value || "").trim().replace(/^<|>$/g, "");
}

// MailerSend activity webhook events
// https://developers.mailersend.com/api/v1/webhooks.html
function mapMailerSendEventToMessageStatus(eventName = "") {
  const e = String(eventName || "").trim().toLowerCase();

  if (["activity.delivered"].includes(e)) return "DELIVERED";
  if (["activity.opened", "activity.clicked"].includes(e)) return "READ";
  if ([
    "activity.soft_bounced",
    "activity.hard_bounced",
    "activity.unsubscribed",
    "activity.spam_complaint",
  ].includes(e)) return "FAILED";
  if (["activity.sent"].includes(e)) return "SENT";
  return null;
}

function parseMailerSendEvents(body) {
  // MailerSend envoie un objet unique { type, data } par webhook
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && body.type) return [body];
  return [];
}

async function findOrderMessageByProviderMessageId(providerMessageId) {
  if (!providerMessageId) return null;
  const normalized = normalizeProviderMessageId(providerMessageId);
  if (!normalized) return null;

  const byExact = await prisma.orderMessage.findFirst({
    where: { channel: "EMAIL", providerMessageId },
  });
  if (byExact) return byExact;

  const recent = await prisma.orderMessage.findMany({
    where: {
      channel: "EMAIL",
      provider: { in: ["SMTP", "EMAIL_SIMULATED"] },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    recent.find(
      (row) => normalizeProviderMessageId(row.providerMessageId || "") === normalized,
    ) || null
  );
}

async function mailerSendEmailEventsWebhook(req, res) {
  if (!isWebhookAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized webhook" });
  }

  try {
    const events = parseMailerSendEvents(req.body || {});
    if (!events.length) {
      return res.status(200).json({ ok: true, received: 0, processed: 0 });
    }

    let processed = 0;
    let unresolved = 0;

    for (const evt of events) {
      const eventName = pickString([evt?.type]);
      // MailerSend payload: { type, data: { email: { id, message: { id } }, recipient: { email } } }
      const providerMessageId = pickString([
        evt?.data?.email?.id,
        evt?.data?.email?.message?.id,
      ]);
      const email = pickString([evt?.data?.recipient?.email]);
      const reason = pickString([evt?.data?.reason, evt?.data?.email?.status]);
      const mappedStatus = mapMailerSendEventToMessageStatus(eventName);
      const now = new Date();

      const message = await findOrderMessageByProviderMessageId(providerMessageId);
      if (!message) {
        unresolved += 1;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        if (mappedStatus) {
          await tx.orderMessage.update({
            where: { id: message.id },
            data: {
              status: mappedStatus,
              lastStatusAt: now,
              deliveredAt:
                mappedStatus === "DELIVERED" ? message.deliveredAt || now : message.deliveredAt,
              readAt:
                mappedStatus === "READ" ? message.readAt || now : message.readAt,
              failedAt:
                mappedStatus === "FAILED" ? message.failedAt || now : message.failedAt,
              errorCode: mappedStatus === "FAILED" ? "MAILERSEND_EMAIL_FAILED" : null,
              errorMessage:
                mappedStatus === "FAILED"
                  ? reason || eventName || "Email delivery failure"
                  : null,
            },
          });
        }

        await tx.orderMessageEvent.create({
          data: {
            orderMessageId: message.id,
            status: mappedStatus || "INFO",
            rawPayload: evt || null,
            note: `MailerSend webhook: ${eventName || "unknown"} (${email || "no-recipient"})`,
          },
        });
      });

      processed += 1;
    }

    return res.status(200).json({ ok: true, received: events.length, processed, unresolved });
  } catch (e) {
    console.error("[email][mailersend][webhook] error", e);
    return res.status(500).json({
      ok: false,
      error: e.message || "Erreur webhook MailerSend",
    });
  }
}

module.exports = {
  mailerSendEmailEventsWebhook,
};
