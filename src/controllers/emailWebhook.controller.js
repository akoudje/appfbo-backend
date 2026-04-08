const prisma = require("../prisma");

function pickString(values = []) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function isWebhookAuthorized(req) {
  const expectedToken = String(process.env.BREVO_WEBHOOK_TOKEN || "").trim();
  if (!expectedToken) return true;

  const headerToken =
    req.get("x-webhook-token") || req.get("x-brevo-webhook-token") || "";
  const queryToken = String(req.query?.token || "");
  return expectedToken === headerToken || expectedToken === queryToken;
}

function normalizeProviderMessageId(value = "") {
  return String(value || "").trim().replace(/^<|>$/g, "");
}

function mapBrevoEventToMessageStatus(eventName = "") {
  const e = String(eventName || "").trim().toLowerCase();

  if (["delivered"].includes(e)) return "DELIVERED";
  if (["opened", "unique_opened", "click", "proxy_open"].includes(e)) {
    return "READ";
  }
  if (
    [
      "hard_bounce",
      "soft_bounce",
      "blocked",
      "invalid",
      "spam",
      "error",
      "unsubscribed",
    ].includes(e)
  ) {
    return "FAILED";
  }
  if (["deferred", "sent", "request"].includes(e)) return "SENT";
  return null;
}

function parseBrevoEvents(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.events)) return body.events;
  if (body && typeof body === "object") return [body];
  return [];
}

async function findOrderMessageByProviderMessageId(providerMessageId) {
  if (!providerMessageId) return null;
  const normalized = normalizeProviderMessageId(providerMessageId);
  if (!normalized) return null;

  const byExact = await prisma.orderMessage.findFirst({
    where: {
      channel: "EMAIL",
      providerMessageId: providerMessageId,
    },
  });
  if (byExact) return byExact;

  const byNormalized = await prisma.orderMessage.findMany({
    where: {
      channel: "EMAIL",
      provider: { in: ["SMTP", "EMAIL_SIMULATED"] },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    byNormalized.find(
      (row) =>
        normalizeProviderMessageId(row.providerMessageId || "") === normalized,
    ) || null
  );
}

async function brevoEmailEventsWebhook(req, res) {
  if (!isWebhookAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized webhook" });
  }

  try {
    const events = parseBrevoEvents(req.body || {});
    if (!events.length) {
      return res.status(200).json({ ok: true, received: 0, processed: 0 });
    }

    let processed = 0;
    let unresolved = 0;

    for (const evt of events) {
      const eventName = pickString([evt?.event, evt?.type, evt?.event_type]);
      const providerMessageId = pickString([
        evt?.["message-id"],
        evt?.messageId,
        evt?.message_id,
        evt?.smtp_id,
      ]);
      const email = pickString([evt?.email, evt?.recipient]);
      const reason = pickString([evt?.reason, evt?.tag, evt?.subject]);
      const mappedStatus = mapBrevoEventToMessageStatus(eventName);
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
                mappedStatus === "DELIVERED"
                  ? message.deliveredAt || now
                  : message.deliveredAt,
              readAt:
                mappedStatus === "READ" ? message.readAt || now : message.readAt,
              failedAt:
                mappedStatus === "FAILED"
                  ? message.failedAt || now
                  : message.failedAt,
              errorCode: mappedStatus === "FAILED" ? "BREVO_EMAIL_FAILED" : null,
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
            note: `Brevo webhook: ${eventName || "unknown"} (${email || "no-recipient"})`,
          },
        });
      });

      processed += 1;
    }

    return res.status(200).json({
      ok: true,
      received: events.length,
      processed,
      unresolved,
    });
  } catch (e) {
    console.error("[email][brevo][webhook] error", e);
    return res.status(500).json({
      ok: false,
      error: e.message || "Erreur webhook Brevo email",
    });
  }
}

module.exports = {
  brevoEmailEventsWebhook,
};
