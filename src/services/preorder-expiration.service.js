const prisma = require("../prisma");
const {
  sendPreorderNotification,
  prependNotificationPrefix,
} = require("./preorder-notifications.service");
const { publishRealtimeEvent } = require("./realtime-events.service");

const FINAL_PAYMENT_STATUSES = new Set([
  "SUCCEEDED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "CANCELLED",
  "EXPIRED",
  "FAILED",
]);

function compactText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getDefaultExpiryHours() {
  return Math.ceil(getDefaultExpiryMinutes() / 60);
}

function getDefaultExpiryMinutes() {
  return Math.max(
    1,
    parsePositiveInt(
      process.env.PREINVOICED_AUTO_CANCEL_AFTER_MINUTES,
      parsePositiveInt(process.env.PREINVOICED_AUTO_CANCEL_AFTER_HOURS, 2) * 60,
    ),
  );
}

function getEffectiveExpiryMinutes(settings = null) {
  const fallback = getDefaultExpiryMinutes();
  const parsed = Number.parseInt(
    String(settings?.preinvoicedAutoCancelAfterMinutes ?? ""),
    10,
  );
  if (Number.isFinite(parsed)) return Math.max(1, parsed);
  const legacyHours = Number.parseInt(
    String(settings?.preinvoicedAutoCancelAfterHours ?? ""),
    10,
  );
  return Math.max(1, Number.isFinite(legacyHours) ? legacyHours * 60 : fallback);
}

function getEffectiveExpiryHours(settings = null) {
  return Math.ceil(getEffectiveExpiryMinutes(settings) / 60);
}

function getDefaultReminderDelayHours() {
  return Math.ceil(getDefaultReminderDelayMinutes() / 60);
}

function getDefaultReminderDelayMinutes() {
  const expiryMinutes = getDefaultExpiryMinutes();
  return Math.min(
    Math.max(
      1,
      parsePositiveInt(
        process.env.PREINVOICED_AUTO_REMINDER_AFTER_MINUTES,
        parsePositiveInt(process.env.PREINVOICED_AUTO_REMINDER_AFTER_HOURS, 1) * 60,
      ),
    ),
    Math.max(1, expiryMinutes - 1),
  );
}

function getEffectiveReminderDelayMinutes(settings = null) {
  const expiryMinutes = getEffectiveExpiryMinutes(settings);
  const fallback = getDefaultReminderDelayMinutes();
  const parsed = Number.parseInt(
    String(settings?.preinvoicedAutoReminderAfterMinutes ?? ""),
    10,
  );
  if (Number.isFinite(parsed)) {
    return Math.min(Math.max(1, parsed), Math.max(1, expiryMinutes - 1));
  }
  const legacyHours = Number.parseInt(
    String(settings?.preinvoicedAutoReminderAfterHours ?? ""),
    10,
  );
  const legacyMinutes = Number.isFinite(legacyHours) ? legacyHours * 60 : fallback;
  return Math.min(
    Math.max(1, legacyMinutes),
    Math.max(1, expiryMinutes - 1),
  );
}

function getEffectiveReminderDelayHours(settings = null) {
  return Math.ceil(getEffectiveReminderDelayMinutes(settings) / 60);
}

function getSchedulerEveryMinutes() {
  return Math.max(
    1,
    parsePositiveInt(process.env.PREINVOICED_AUTO_CANCEL_CHECK_EVERY_MINUTES, 5),
  );
}

function getWaveFinalizationGraceMinutes() {
  return Math.max(
    0,
    parsePositiveInt(process.env.PREINVOICED_WAVE_FINALIZATION_GRACE_MINUTES, 15),
  );
}

function getAutoCancelRunnerMode() {
  return String(process.env.PREINVOICED_AUTO_CANCEL_RUNNER || "embedded")
    .trim()
    .toLowerCase();
}

function buildInvoiceExpiryAt(invoicedAt, settings = null) {
  const baseTime = new Date(invoicedAt);
  if (Number.isNaN(baseTime.getTime())) return null;
  return new Date(
    baseTime.getTime() + getEffectiveExpiryMinutes(settings) * 60 * 1000,
  );
}

function formatFcfa(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0 FCFA";
  return `${new Intl.NumberFormat("fr-FR").format(Math.max(0, Math.round(num)))} FCFA`;
}

function buildReminderCutoffAt(invoicedAt, settings = null) {
  const baseTime = new Date(invoicedAt);
  if (Number.isNaN(baseTime.getTime())) return null;
  return new Date(
    baseTime.getTime() + getEffectiveReminderDelayMinutes(settings) * 60 * 1000,
  );
}

function formatDuration(minutes) {
  const total = Math.max(1, Number.parseInt(String(minutes ?? ""), 10) || 1);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours > 0 && mins > 0) return `${hours}h${String(mins).padStart(2, "0")}`;
  if (hours > 0) return `${hours}h`;
  return `${mins} min`;
}

function buildPaymentReminderMessage(preorder, paymentLink = null, settings = null) {
  const normalizedLink = String(paymentLink || "").trim();
  const collectionCode = compactText(
    preorder?.paymentCollectionCode || preorder?.preorderNumber || preorder?.id || "-",
  );
  const amountFmt = formatFcfa(preorder?.totalFcfa || preorder?.as400InvoiceTotalFcfa || 0);
  const remainingMinutes = Math.max(
    1,
    getEffectiveExpiryMinutes(settings) - getEffectiveReminderDelayMinutes(settings),
  );
  const remainingLabel = formatDuration(remainingMinutes);
  const paymentMode = String(
    preorder?.preorderPaymentMode || preorder?.paymentMode || preorder?.paymentProvider || "",
  )
    .trim()
    .toUpperCase();

  if (paymentMode.includes("BANK")) {
    if (normalizedLink) {
      return prependNotificationPrefix(
        preorder,
        compactText(
          `Rappel: code paiement ${collectionCode}. Montant ${amountFmt}. Effectuez le virement puis deposez votre preuve sous ${remainingLabel}: ${normalizedLink}`,
        ),
      );
    }
    return prependNotificationPrefix(
      preorder,
      compactText(
        `Rappel: code paiement ${collectionCode}. Montant ${amountFmt}. Finalisez votre virement sous ${remainingLabel} pour éviter l'annulation.`,
      ),
    );
  }

  if (normalizedLink || paymentMode.includes("WAVE")) {
    return prependNotificationPrefix(
      preorder,
      compactText(
        `Rappel: code paiement ${collectionCode}. Montant ${amountFmt}. Finalisez le paiement sous ${remainingLabel}: ${normalizedLink}`,
      ),
    );
  }

  return prependNotificationPrefix(
    preorder,
    compactText(
      `Rappel: code paiement ${collectionCode}. Montant ${amountFmt}. Passez a la caisse FLP sous ${remainingLabel} pour éviter l'annulation.`,
    ),
  );
}

function buildAutoCancelMessage(preorder, settings = null) {
  const customer = compactText(preorder?.fboNomComplet || "Client");
  const preorderNumber = compactText(
    preorder?.preorderNumber || preorder?.paymentCollectionCode || preorder?.id || "-",
  );

  return prependNotificationPrefix(preorder, compactText(`
    Bonjour ${customer}, votre precommande ${preorderNumber} a ete annulee
    faute de paiement confirme dans le delai maximal de ${formatDuration(getEffectiveExpiryMinutes(settings))} apres
    prefacturation. Vous pouvez lancer une nouvelle precommande si besoin.
  `));
}

async function cancelPreorderAsExpiredUnpaid({ preorderId, now = new Date() }) {
  const order = await prisma.preorder.findUnique({
    where: { id: preorderId },
    include: {
      items: true,
      activePayment: true,
      country: {
        select: {
          id: true,
          code: true,
          settings: {
            select: {
              preinvoicedAutoCancelAfterHours: true,
              preinvoicedAutoReminderAfterHours: true,
              preinvoicedAutoCancelAfterMinutes: true,
              preinvoicedAutoReminderAfterMinutes: true,
            },
          },
        },
      },
    },
  });

  if (!order) {
    return { ok: false, reason: "PREORDER_NOT_FOUND" };
  }

  const status = String(order.status || "").toUpperCase();
  const paymentStatus = String(order.paymentStatus || "").toUpperCase();
  if (!["INVOICED", "PAYMENT_PENDING"].includes(status) || paymentStatus === "PAID") {
    return { ok: false, reason: "PREORDER_NOT_ELIGIBLE", preorder: order };
  }
  if (String(order.lastWhatsappStatus || "").toUpperCase() === "FAILED") {
    return { ok: false, reason: "INITIAL_PAYMENT_NOTIFICATION_FAILED", preorder: order };
  }
  if (
    ["BANK_TRANSFER", "ECOBANK_PAY"].includes(String(order.preorderPaymentMode || "").toUpperCase()) &&
    ["PROOF_SUBMITTED", "UNDER_REVIEW", "APPROVED"].includes(
      String(order.bankPaymentStatus || "").toUpperCase(),
    )
  ) {
    return { ok: false, reason: "BANK_PROOF_ALREADY_SUBMITTED", preorder: order };
  }
  const countrySettings = order.country?.settings || null;
  const expiryAt = buildInvoiceExpiryAt(order.invoicedAt, countrySettings);
  if (!expiryAt || now.getTime() < expiryAt.getTime()) {
    return { ok: false, reason: "PAYMENT_WINDOW_NOT_EXPIRED", preorder: order };
  }

  const isWavePayment =
    String(order.preorderPaymentMode || order.paymentProvider || "")
      .trim()
      .toUpperCase() === "WAVE" ||
    String(order.activePayment?.provider || "")
      .trim()
      .toUpperCase() === "WAVE";
  const waveGraceMinutes = getWaveFinalizationGraceMinutes();
  const waveGraceMs = waveGraceMinutes * 60 * 1000;

  if (
    isWavePayment &&
    waveGraceMs > 0 &&
    now.getTime() < expiryAt.getTime() + waveGraceMs
  ) {
    return {
      ok: false,
      reason: "WAVE_FINALIZATION_GRACE_WINDOW",
      preorder: order,
    };
  }

  if (isWavePayment && order.country?.id) {
    try {
      const { syncWavePaymentStatus } = require("../payments/payments.service");
      const syncResult = await syncWavePaymentStatus({
        req: {
          user: null,
          countryId: order.country.id,
          country: { id: order.country.id },
        },
        preorderId: order.id,
      });

      if (
        String(syncResult?.preorder?.paymentStatus || "").toUpperCase() === "PAID" ||
        String(syncResult?.payment?.status || "").toUpperCase() === "SUCCEEDED"
      ) {
        return {
          ok: false,
          reason: "WAVE_PAYMENT_CONFIRMED_DURING_SYNC",
          preorder: syncResult.preorder || order,
        };
      }
    } catch (error) {
      console.warn("[preorder-expiration] wave sync before cancel failed", {
        preorderId: order.id,
        message: error?.message || String(error),
      });
    }
  }

  const cancelReason =
    `Précommande préfacturée annulée automatiquement après ${getEffectiveExpiryHours(countrySettings)}H sans paiement confirmé.`;

  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.preorder.findUnique({
      where: { id: preorderId },
      include: {
        items: true,
        activePayment: true,
      },
    });

    if (!current) {
      return null;
    }

    const currentStatus = String(current.status || "").toUpperCase();
    const currentPaymentStatus = String(current.paymentStatus || "").toUpperCase();
    if (
      !["INVOICED", "PAYMENT_PENDING"].includes(currentStatus) ||
      currentPaymentStatus === "PAID"
    ) {
      return null;
    }
    if (String(current.lastWhatsappStatus || "").toUpperCase() === "FAILED") {
      return null;
    }
    if (
      ["BANK_TRANSFER", "ECOBANK_PAY"].includes(String(current.preorderPaymentMode || "").toUpperCase()) &&
      ["PROOF_SUBMITTED", "UNDER_REVIEW", "APPROVED"].includes(
        String(current.bankPaymentStatus || "").toUpperCase(),
      )
    ) {
      return null;
    }
    const currentExpiryAt = buildInvoiceExpiryAt(current.invoicedAt, countrySettings);
    if (!currentExpiryAt || now.getTime() < currentExpiryAt.getTime()) {
      return null;
    }

    const currentIsWavePayment =
      String(current.preorderPaymentMode || current.paymentProvider || "")
        .trim()
        .toUpperCase() === "WAVE" ||
      String(current.activePayment?.provider || "")
        .trim()
        .toUpperCase() === "WAVE";
    if (
      currentIsWavePayment &&
      waveGraceMs > 0 &&
      now.getTime() < currentExpiryAt.getTime() + waveGraceMs
    ) {
      return null;
    }

    const mustRollbackStock = !!current.stockDeductedAt && !current.stockRestoredAt;

    if (mustRollbackStock) {
      for (const item of current.items) {
        await tx.countryProduct.update({
          where: {
            countryId_productId: {
              countryId: current.countryId,
              productId: item.productId,
            },
          },
          data: {
            stockQty: { increment: item.qty },
          },
        });

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            countryId: current.countryId,
            preorderId: current.id,
            type: "CREDIT",
            reason: "CANCEL_ORDER",
            qty: item.qty,
            note: "Retour stock suite annulation automatique commande impayée",
            meta: {
              preorderId: current.id,
              productId: item.productId,
              qty: item.qty,
              mode: "AUTO_CANCEL_UNPAID_AFTER_EXPIRY_WINDOW",
            },
            createdById: null,
          },
        });
      }
    }

    await tx.payment.updateMany({
      where: {
        preorderId: current.id,
        status: {
          notIn: Array.from(FINAL_PAYMENT_STATUSES),
        },
      },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
      },
    });

    const saved = await tx.preorder.update({
      where: { id: current.id },
      data: {
        status: "CANCELLED",
        paymentStatus:
          currentPaymentStatus === "PAID" ? current.paymentStatus : "UNPAID",
        cancelledAt: current.cancelledAt || now,
        cancelReason,
        cancelledById: current.cancelledById || null,
        activePaymentId: null,
        paidAt: null,
        stockRestoredAt:
          mustRollbackStock && !current.stockRestoredAt ? now : current.stockRestoredAt,
        billingWorkStatus: "COMPLETED",
        billingCompletedAt: current.billingCompletedAt || now,
        billingLastActivityAt: now,
      },
    });

    await tx.preorderLog.create({
      data: {
        preorderId: current.id,
        action: "CANCEL",
        note: cancelReason,
        meta: {
          fromStatus: current.status,
          toStatus: "CANCELLED",
          stockRollback: mustRollbackStock,
          mode: "AUTO_CANCEL_UNPAID_AFTER_EXPIRY_WINDOW",
          expiryHours: getEffectiveExpiryHours(countrySettings),
          invoicedAt: current.invoicedAt ? new Date(current.invoicedAt).toISOString() : null,
          expiredAt: currentExpiryAt.toISOString(),
        },
        actorAdminId: null,
      },
    });

    return saved;
  });

  if (!updated) {
    return { ok: false, reason: "PREORDER_ALREADY_PROCESSED" };
  }

  try {
    const latestPaymentMessage = await prisma.orderMessage.findFirst({
      where: {
        preorderId,
        purpose: { in: ["INVOICE", "PAYMENT_LINK"] },
      },
      orderBy: { createdAt: "desc" },
      select: { paymentLinkTracked: true, paymentLinkTarget: true },
    });
    const cancelPaymentLink = String(
      latestPaymentMessage?.paymentLinkTracked || latestPaymentMessage?.paymentLinkTarget || "",
    ).trim();

    await sendPreorderNotification({
      preorder: {
        ...order,
        ...updated,
      },
      purpose: "REMINDER",
      message: buildAutoCancelMessage({
        ...order,
        ...updated,
      }, countrySettings),
      actorName: "SYSTEM_AUTO_CANCEL_EXPIRY_WINDOW",
      paymentLinkTarget: cancelPaymentLink || null,
      paymentLinkTracked: cancelPaymentLink || null,
    });
  } catch (error) {
    console.error("[preorder-expiration] notification failed", {
      preorderId,
      error: error?.message || String(error),
    });
  }

  publishRealtimeEvent({
    countryId: order.countryId || order.country?.id || null,
    eventKey: "billing_queue_new",
    orderId: updated.id,
    meta: {
      status: "CANCELLED",
      billingWorkStatus: updated.billingWorkStatus || "COMPLETED",
      autoCancelled: true,
    },
  });

  return { ok: true, preorder: updated };
}

async function sendReminderForDuePreorders({ now = new Date(), dryRun = false } = {}) {
  const candidates = await prisma.preorder.findMany({
    where: {
      status: { in: ["INVOICED", "PAYMENT_PENDING"] },
      paymentStatus: { not: "PAID" },
      cancelledAt: null,
      invoicedAt: { not: null },
      NOT: {
        AND: [
          { preorderPaymentMode: { in: ["BANK_TRANSFER", "ECOBANK_PAY"] } },
          { bankPaymentStatus: { in: ["PROOF_SUBMITTED", "UNDER_REVIEW", "APPROVED"] } },
        ],
      },
    },
    select: {
      id: true,
      preorderNumber: true,
      invoicedAt: true,
      totalFcfa: true,
      as400InvoiceTotalFcfa: true,
      preorderPaymentMode: true,
      paymentCollectionCode: true,
      countryId: true,
      fboNomComplet: true,
      country: {
        select: {
          settings: {
            select: {
              preinvoicedAutoCancelAfterHours: true,
              preinvoicedAutoReminderAfterHours: true,
              preinvoicedAutoCancelAfterMinutes: true,
              preinvoicedAutoReminderAfterMinutes: true,
            },
          },
        },
      },
    },
    orderBy: [{ invoicedAt: "asc" }, { createdAt: "asc" }],
  });

  const due = [];
  for (const candidate of candidates) {
    const countrySettings = candidate.country?.settings || null;
    const reminderAt = buildReminderCutoffAt(candidate.invoicedAt, countrySettings);
    const expiryAt = buildInvoiceExpiryAt(candidate.invoicedAt, countrySettings);
    if (!reminderAt || !expiryAt) continue;
    if (now.getTime() < reminderAt.getTime()) continue;
    if (now.getTime() >= expiryAt.getTime()) continue;

    const existingReminder = await prisma.preorderLog.findFirst({
      where: {
        preorderId: candidate.id,
        action: "PAYMENT_PENDING",
        createdAt: { gte: candidate.invoicedAt || new Date(0) },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        meta: true,
      },
    });

    const alreadySent =
      existingReminder &&
      String(existingReminder.meta?.mode || "").toUpperCase() === "AUTO_REMINDER_BEFORE_EXPIRY";

    if (!alreadySent) {
      due.push(candidate);
    }
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      remindersDueCount: due.length,
      remindersDue: due.map((row) => ({
        id: row.id,
        preorderNumber: row.preorderNumber,
        reminderHours: getEffectiveReminderDelayHours(row.country?.settings || null),
      })),
    };
  }

  const reminded = [];
  for (const candidate of due) {
    const latestMessage = await prisma.orderMessage.findFirst({
      where: {
        preorderId: candidate.id,
        purpose: { in: ["INVOICE", "PAYMENT_LINK", "REMINDER"] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        paymentLinkTracked: true,
        paymentLinkTarget: true,
      },
    });

    const paymentLink = String(
      latestMessage?.paymentLinkTracked || latestMessage?.paymentLinkTarget || "",
    ).trim();
    const countrySettings = candidate.country?.settings || null;
    const reminderMessage = buildPaymentReminderMessage(
      candidate,
      paymentLink,
      countrySettings,
    );

    try {
      const notificationResult = await sendPreorderNotification({
        preorder: candidate,
        purpose: "REMINDER",
        message: reminderMessage,
        actorName: "SYSTEM_AUTO_REMINDER_BEFORE_EXPIRY",
        paymentLinkTarget: paymentLink || null,
        paymentLinkTracked: paymentLink || null,
      });

      await prisma.preorderLog.create({
        data: {
          preorderId: candidate.id,
          action: "PAYMENT_PENDING",
          note: "Rappel automatique de paiement envoyé",
          actorAdminId: null,
          meta: {
            mode: "AUTO_REMINDER_BEFORE_EXPIRY",
            reminderHours: getEffectiveReminderDelayHours(countrySettings),
            smsSent: Boolean(notificationResult?.smsSent),
            smsQueued: Boolean(notificationResult?.smsQueued),
            notificationChannel: notificationResult?.channel || null,
            notificationAttempts: notificationResult?.attempts || [],
          },
        },
      });

      reminded.push({
        id: candidate.id,
        preorderNumber: candidate.preorderNumber,
      });
    } catch (error) {
      console.error("[preorder-expiration] reminder send failed", {
        preorderId: candidate.id,
        error: error?.message || String(error),
      });
    }
  }

  return {
    ok: true,
    dryRun: false,
    remindersSentCount: reminded.length,
    reminded,
  };
}

async function cancelExpiredInvoicedPreorders({ now = new Date(), dryRun = false } = {}) {
  const candidates = await prisma.preorder.findMany({
    where: {
      status: { in: ["INVOICED", "PAYMENT_PENDING"] },
      paymentStatus: { not: "PAID" },
      cancelledAt: null,
      invoicedAt: { not: null },
      OR: [
        { lastWhatsappStatus: null },
        { lastWhatsappStatus: { not: "FAILED" } },
      ],
      NOT: {
        AND: [
          { preorderPaymentMode: { in: ["BANK_TRANSFER", "ECOBANK_PAY"] } },
          { bankPaymentStatus: { in: ["PROOF_SUBMITTED", "UNDER_REVIEW", "APPROVED"] } },
        ],
      },
    },
    select: {
      id: true,
      preorderNumber: true,
      invoicedAt: true,
      status: true,
      paymentStatus: true,
      preorderPaymentMode: true,
      bankPaymentStatus: true,
      country: {
        select: {
          settings: {
            select: {
              preinvoicedAutoCancelAfterHours: true,
              preinvoicedAutoReminderAfterHours: true,
              preinvoicedAutoCancelAfterMinutes: true,
              preinvoicedAutoReminderAfterMinutes: true,
            },
          },
        },
      },
    },
    orderBy: [{ invoicedAt: "asc" }, { createdAt: "asc" }],
  });

  const dueCandidates = candidates.filter((candidate) => {
    const expiryAt = buildInvoiceExpiryAt(
      candidate.invoicedAt,
      candidate.country?.settings || null,
    );
    return expiryAt && now.getTime() >= expiryAt.getTime();
  });

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      checkedAt: now.toISOString(),
      cancelledCount: dueCandidates.length,
      cancelled: dueCandidates.map((candidate) => ({
        ...candidate,
        expiryHours: getEffectiveExpiryHours(candidate.country?.settings || null),
      })),
    };
  }

  const cancelled = [];
  for (const candidate of dueCandidates) {
    const result = await cancelPreorderAsExpiredUnpaid({
      preorderId: candidate.id,
      now,
    });
    if (result?.ok && result.preorder) {
      cancelled.push({
        id: result.preorder.id,
        preorderNumber: result.preorder.preorderNumber,
      });
    }
  }

  return {
    ok: true,
    dryRun: false,
    checkedAt: now.toISOString(),
    cancelledCount: cancelled.length,
    cancelled,
  };
}

function startExpiredInvoiceAutoCancelScheduler() {
  if (String(process.env.PREINVOICED_AUTO_CANCEL_ENABLED || "true").toLowerCase() !== "true") {
    console.info("[preorder-expiration] embedded scheduler disabled via PREINVOICED_AUTO_CANCEL_ENABLED");
    return null;
  }

  const runnerMode = getAutoCancelRunnerMode();
  if (!["embedded", "both"].includes(runnerMode)) {
    console.info("[preorder-expiration] embedded scheduler skipped", {
      runnerMode,
    });
    return null;
  }

  const intervalMs = getSchedulerEveryMinutes() * 60 * 1000;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const reminderResult = await sendReminderForDuePreorders({ now });
      if (reminderResult) {
        console.log("[preorder-expiration] reminder summary", reminderResult);
      }
      const result = await cancelExpiredInvoicedPreorders({ now });
      if (!result?.skipped) {
        console.log("[preorder-expiration] auto-cancel summary", result);
      }
    } catch (error) {
      console.error("[preorder-expiration] scheduler error", error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  tick().catch(() => {});
  return timer;
}

module.exports = {
  buildAutoCancelMessage,
  buildPaymentReminderMessage,
  cancelPreorderAsExpiredUnpaid,
  cancelExpiredInvoicedPreorders,
  getEffectiveReminderDelayHours,
  getAutoCancelRunnerMode,
  sendReminderForDuePreorders,
  startExpiredInvoiceAutoCancelScheduler,
};
