const prisma = require("../prisma");
const { sendPreorderNotification } = require("./preorder-notifications.service");
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

function getExpiryHours() {
  return Math.max(
    1,
    parsePositiveInt(process.env.PREINVOICED_AUTO_CANCEL_AFTER_HOURS, 3),
  );
}

function getSchedulerEveryMinutes() {
  return Math.max(
    1,
    parsePositiveInt(process.env.PREINVOICED_AUTO_CANCEL_CHECK_EVERY_MINUTES, 5),
  );
}

function buildInvoiceExpiryAt(invoicedAt) {
  const baseTime = new Date(invoicedAt);
  if (Number.isNaN(baseTime.getTime())) return null;
  return new Date(baseTime.getTime() + getExpiryHours() * 60 * 60 * 1000);
}

function buildAutoCancelMessage(preorder) {
  const customer = compactText(preorder?.fboNomComplet || "Client");
  const preorderNumber = compactText(
    preorder?.preorderNumber || preorder?.paymentCollectionCode || preorder?.id || "-",
  );

  return compactText(`
    Bonjour ${customer}, votre precommande ${preorderNumber} a ete annulee
    faute de paiement confirme dans le delai maximal de ${getExpiryHours()}H apres
    prefacturation. Vous pouvez lancer une nouvelle precommande si besoin.
  `);
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
    String(order.preorderPaymentMode || "").toUpperCase() === "BANK_TRANSFER" &&
    ["PROOF_SUBMITTED", "UNDER_REVIEW", "APPROVED"].includes(
      String(order.bankPaymentStatus || "").toUpperCase(),
    )
  ) {
    return { ok: false, reason: "BANK_PROOF_ALREADY_SUBMITTED", preorder: order };
  }
  const expiryAt = buildInvoiceExpiryAt(order.invoicedAt);
  if (!expiryAt || now.getTime() < expiryAt.getTime()) {
    return { ok: false, reason: "PAYMENT_WINDOW_NOT_EXPIRED", preorder: order };
  }

  const cancelReason =
    `Précommande préfacturée annulée automatiquement après ${getExpiryHours()}H sans paiement confirmé.`;

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
      String(current.preorderPaymentMode || "").toUpperCase() === "BANK_TRANSFER" &&
      ["PROOF_SUBMITTED", "UNDER_REVIEW", "APPROVED"].includes(
        String(current.bankPaymentStatus || "").toUpperCase(),
      )
    ) {
      return null;
    }
    const currentExpiryAt = buildInvoiceExpiryAt(current.invoicedAt);
    if (!currentExpiryAt || now.getTime() < currentExpiryAt.getTime()) {
      return null;
    }

    const mustRollbackStock = !!current.stockDeductedAt && !current.stockRestoredAt;

    if (mustRollbackStock) {
      for (const item of current.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stockQty: { increment: item.qty },
          },
        });

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
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
          expiryHours: getExpiryHours(),
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
    await sendPreorderNotification({
      preorder: {
        ...order,
        ...updated,
      },
      purpose: "REMINDER",
      message: buildAutoCancelMessage({
        ...order,
        ...updated,
      }),
      actorName: "SYSTEM_AUTO_CANCEL_EXPIRY_WINDOW",
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

async function cancelExpiredInvoicedPreorders({ now = new Date(), dryRun = false } = {}) {
  const expiryHours = getExpiryHours();
  const expiryCutoff = new Date(now.getTime() - expiryHours * 60 * 60 * 1000);
  const candidates = await prisma.preorder.findMany({
    where: {
      status: { in: ["INVOICED", "PAYMENT_PENDING"] },
      paymentStatus: { not: "PAID" },
      cancelledAt: null,
      invoicedAt: { not: null, lte: expiryCutoff },
      OR: [
        { lastWhatsappStatus: null },
        { lastWhatsappStatus: { not: "FAILED" } },
      ],
      NOT: {
        AND: [
          { preorderPaymentMode: "BANK_TRANSFER" },
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
    },
    orderBy: [{ invoicedAt: "asc" }, { createdAt: "asc" }],
  });

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      expiryHours,
      expiresBefore: expiryCutoff.toISOString(),
      checkedAt: now.toISOString(),
      cancelledCount: candidates.length,
      cancelled: candidates,
    };
  }

  const cancelled = [];
  for (const candidate of candidates) {
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
    expiryHours,
    expiresBefore: expiryCutoff.toISOString(),
    checkedAt: now.toISOString(),
    cancelledCount: cancelled.length,
    cancelled,
  };
}

function startExpiredInvoiceAutoCancelScheduler() {
  if (String(process.env.PREINVOICED_AUTO_CANCEL_ENABLED || "true").toLowerCase() !== "true") {
    return null;
  }

  const intervalMs = getSchedulerEveryMinutes() * 60 * 1000;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await cancelExpiredInvoicedPreorders();
      if (!result?.skipped && result?.cancelledCount) {
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
  cancelPreorderAsExpiredUnpaid,
  cancelExpiredInvoicedPreorders,
  startExpiredInvoiceAutoCancelScheduler,
};
