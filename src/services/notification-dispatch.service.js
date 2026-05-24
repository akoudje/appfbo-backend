const prisma = require("../prisma");
const { sendSms } = require("./sms.service");

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getDispatchEverySeconds() {
  return Math.max(
    10,
    parsePositiveInt(process.env.NOTIFICATION_DISPATCH_EVERY_SECONDS, 20),
  );
}

function getDispatchBatchSize() {
  return Math.max(
    1,
    parsePositiveInt(process.env.NOTIFICATION_DISPATCH_BATCH_SIZE, 10),
  );
}

function getDispatcherMode() {
  return String(process.env.NOTIFICATION_DISPATCH_RUNNER || "embedded")
    .trim()
    .toLowerCase();
}

function buildRetryDelaySeconds(attemptNumber = 1) {
  const base = Math.max(
    15,
    parsePositiveInt(process.env.NOTIFICATION_SMS_RETRY_BASE_SECONDS, 30),
  );
  const multiplier = Math.max(0, Number(attemptNumber) - 1);
  return base * Math.pow(2, multiplier);
}

function buildNextAttemptAt(attemptNumber = 1, fromDate = new Date()) {
  const delaySeconds = buildRetryDelaySeconds(attemptNumber);
  return new Date(fromDate.getTime() + delaySeconds * 1000);
}

async function appendOrderMessageEvent(tx, orderMessageId, status, note, rawPayload = null) {
  await tx.orderMessageEvent.create({
    data: {
      orderMessageId,
      status,
      note,
      rawPayload,
    },
  });
}

async function processQueuedSmsMessage(message) {
  const now = new Date();
  const claim = await prisma.orderMessage.updateMany({
    where: {
      id: message.id,
      channel: "SMS",
      status: "QUEUED",
      processingStartedAt: null,
    },
    data: {
      processingStartedAt: now,
      lastAttemptAt: now,
      attempts: { increment: 1 },
      nextAttemptAt: null,
    },
  });

  if (!claim.count) {
    return { ok: false, skipped: true, reason: "ALREADY_CLAIMED", messageId: message.id };
  }

  const current = await prisma.orderMessage.findUnique({
    where: { id: message.id },
    select: {
      id: true,
      preorderId: true,
      toPhone: true,
      body: true,
      attempts: true,
      maxAttempts: true,
      preorder: {
        select: {
          country: {
            select: { code: true },
          },
        },
      },
    },
  });

  if (!current?.toPhone || !current?.body) {
    await prisma.$transaction(async (tx) => {
      await tx.orderMessage.update({
        where: { id: message.id },
        data: {
          status: "FAILED",
          processingStartedAt: null,
          failedAt: now,
          lastStatusAt: now,
          errorCode: "INVALID_QUEUE_MESSAGE",
          errorMessage: "Message SMS incomplet dans la file d'envoi.",
        },
      });

      await tx.preorder.update({
        where: { id: current?.preorderId || message.preorderId },
        data: {
          lastWhatsappStatus: "FAILED",
          lastWhatsappStatusAt: now,
        },
      });

      await appendOrderMessageEvent(
        tx,
        message.id,
        "FAILED",
        "Message SMS invalide dans la file d'envoi.",
      );
    });

    return { ok: false, skipped: false, reason: "INVALID_QUEUE_MESSAGE", messageId: message.id };
  }

  const sendResult = await sendSms({
    to: current.toPhone,
    message: current.body,
    callbackData: current.preorderId,
    countryCode: current.preorder?.country?.code || "CIV",
  });

  const exhausted = current.attempts >= Math.max(1, Number(current.maxAttempts) || 1);
  const nextStatus = sendResult.accepted ? "SENT" : exhausted ? "FAILED" : "QUEUED";
  const nextAttemptAt = sendResult.accepted || exhausted
    ? null
    : buildNextAttemptAt(current.attempts, now);

  await prisma.$transaction(async (tx) => {
    await tx.orderMessage.update({
      where: { id: current.id },
      data: {
        status: nextStatus,
        processingStartedAt: null,
        provider: sendResult.provider || "ORANGE",
        providerMessageId: sendResult.providerMessageId || null,
        sentAt: sendResult.accepted ? now : null,
        failedAt: nextStatus === "FAILED" ? now : null,
        lastStatusAt: now,
        nextAttemptAt,
        errorCode: sendResult.accepted ? null : sendResult.errorCode || null,
        errorMessage: sendResult.accepted ? null : sendResult.errorMessage || null,
      },
    });

    await tx.preorder.update({
      where: { id: current.preorderId },
      data: {
        lastWhatsappStatus: nextStatus,
        lastWhatsappStatusAt: now,
        lastWhatsappMessageId: sendResult.providerMessageId || null,
      },
    });

    await appendOrderMessageEvent(
      tx,
      current.id,
      nextStatus,
      sendResult.accepted
        ? `SMS envoyé au provider (tentative ${current.attempts}/${current.maxAttempts}).`
        : nextStatus === "FAILED"
          ? `Échec final SMS après ${current.attempts}/${current.maxAttempts} tentatives.`
          : `Tentative SMS échouée (${current.attempts}/${current.maxAttempts}). Nouvelle tentative planifiée.`,
      sendResult.rawPayload || null,
    );
  });

  return {
    ok: true,
    skipped: false,
    messageId: current.id,
    preorderId: current.preorderId,
    status: nextStatus,
    accepted: Boolean(sendResult.accepted),
    provider: sendResult.provider || "ORANGE",
    providerMessageId: sendResult.providerMessageId || null,
  };
}

async function dispatchQueuedNotificationsOnce() {
  const now = new Date();
  const dueMessages = await prisma.orderMessage.findMany({
    where: {
      channel: "SMS",
      status: "QUEUED",
      processingStartedAt: null,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: getDispatchBatchSize(),
    select: {
      id: true,
      preorderId: true,
    },
  });

  const results = [];
  for (const message of dueMessages) {
    try {
      results.push(await processQueuedSmsMessage(message));
    } catch (error) {
      console.error("[notification-dispatch] queued SMS processing failed", {
        messageId: message.id,
        preorderId: message.preorderId,
        error: error?.message || "Unknown error",
      });
    }
  }

  return {
    ok: true,
    processed: results.length,
    results,
  };
}

let dispatchTimer = null;
let dispatchRunning = false;

function startNotificationDispatchScheduler() {
  if (getDispatcherMode() !== "embedded") {
    console.log("[notification-dispatch] embedded scheduler disabled");
    return;
  }

  if (dispatchTimer) return;

  const tick = async () => {
    if (dispatchRunning) return;
    dispatchRunning = true;
    try {
      await dispatchQueuedNotificationsOnce();
    } catch (error) {
      console.error("[notification-dispatch] tick failed", error);
    } finally {
      dispatchRunning = false;
    }
  };

  const everyMs = getDispatchEverySeconds() * 1000;
  dispatchTimer = setInterval(tick, everyMs);
  if (typeof dispatchTimer.unref === "function") {
    dispatchTimer.unref();
  }

  tick().catch((error) => {
    console.error("[notification-dispatch] initial tick failed", error);
  });
  console.log(
    `[notification-dispatch] scheduler started every ${getDispatchEverySeconds()}s`,
  );
}

module.exports = {
  dispatchQueuedNotificationsOnce,
  startNotificationDispatchScheduler,
};
