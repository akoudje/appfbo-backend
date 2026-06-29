const prisma = require("../prisma");
const paymentOrchestrator = require("../payments/payment-orchestrator.service");
const { mapWaveSessionToInternal } = require("../payments/payment-status.mapper");
const { normalizeForCountry } = require("../utils/phone");
const {
  ensureTicketsActivatedForPaidOrder,
  paidOrderTicketInclude,
} = require("./ticket-order-ticketing.service");
const { sendTicketOrderEmail } = require("./ticket-email-notifications.service");
const {
  extractWaveProviderMetadata,
  firstNonEmptyString,
} = require("../payments/wave-metadata");

function isWaveSimulationEnabled() {
  return String(process.env.ENABLE_WAVE_SIMULATION || "false") === "true";
}

function getRequestOrigin(req = null) {
  const origin = req?.get?.("origin") || req?.headers?.origin || "";
  if (!origin) return "";
  try {
    return new URL(origin).origin;
  } catch {
    return "";
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function publicBaseUrl(req = null) {
  const configured =
    process.env.APP_PUBLIC_BASE_URL ||
    process.env.FRONTEND_PUBLIC_URL ||
    process.env.PUBLIC_APP_URL ||
    "";
  if (isHttpsUrl(configured)) return configured.replace(/\/+$/, "");

  const requestOrigin = getRequestOrigin(req);
  if (isHttpsUrl(requestOrigin)) return requestOrigin.replace(/\/+$/, "");

  return (configured || "http://localhost:5173").replace(/\/+$/, "");
}

function buildTicketOrderUrl(orderNumber, countryCode = "CIV", req = null) {
  return `${publicBaseUrl(req)}/tickets/${encodeURIComponent(orderNumber)}?country=${encodeURIComponent(countryCode || "CIV")}`;
}

function buildWaveUrls(order, req = null) {
  const base = buildTicketOrderUrl(order.orderNumber, order.country?.code || "CIV", req);
  return {
    successUrl: `${base}&wave=success`,
    errorUrl: `${base}&wave=error`,
  };
}

function extractProviderMetadata(response = {}) {
  const raw = response.raw || response || {};
  const metadata = extractWaveProviderMetadata(raw);
  return {
    providerSessionId: response.providerSessionId || metadata.providerSessionId || null,
    providerTransactionId: response.providerTransactionId || metadata.providerTransactionId || null,
    providerPayerPhone: response.providerPayerPhone || metadata.providerPayerPhone || null,
    providerStatusLabel: response.providerStatusLabel || metadata.providerStatusLabel || null,
    completedAt: metadata.completedAt || null,
  };
}

function buildSimulatedProviderResponse({ order, successUrl }) {
  const providerSessionId = `ticket_wave_sim_${order.id}_${Date.now()}`;
  return {
    provider: "WAVE",
    raw: {
      id: providerSessionId,
      client_reference: `TICKET:${order.id}`,
      checkout_status: "open",
      payment_status: "processing",
      wave_launch_url: `${successUrl}&simulated=1`,
      simulated: true,
    },
    providerSessionId,
    providerTransactionId: null,
    providerPayerPhone: null,
    providerStatusLabel: "simulation_open",
    checkoutUrl: `${successUrl}&simulated=1`,
    providerLaunchUrl: `${successUrl}&simulated=1`,
    clientReference: `TICKET:${order.id}`,
    checkoutStatus: "open",
    paymentStatus: "processing",
  };
}

function simulatedStatusPayload(order) {
  return {
    id: order.providerSessionId,
    client_reference: `TICKET:${order.id}`,
    checkout_status: "complete",
    payment_status: "succeeded",
    transaction_id: order.providerTransactionId || `ticket_txn_${order.id}`,
    simulated: true,
  };
}

async function findTicketOrderByNumber({ req, orderNumber }) {
  return prisma.ticketOrder.findFirst({
    where: {
      countryId: req.countryId,
      orderNumber: String(orderNumber || "").trim().toUpperCase(),
    },
    include: {
      country: { select: { code: true } },
      event: true,
      ticketType: true,
      tickets: { include: { ticketType: true } },
    },
  });
}

async function initiateTicketWavePayment({ req, orderNumber, payerPhone }) {
  const order = await findTicketOrderByNumber({ req, orderNumber });
  if (!order) {
    const err = new Error("Commande billet introuvable");
    err.statusCode = 404;
    throw err;
  }
  if (order.status === "PAID" || order.paymentStatus === "SUCCEEDED") {
    const err = new Error("Paiement deja confirme pour cet achat");
    err.statusCode = 409;
    throw err;
  }
  if (!["PENDING_PAYMENT", "DRAFT"].includes(order.status)) {
    const err = new Error(`Impossible d'initier Wave depuis le statut ${order.status}`);
    err.statusCode = 400;
    throw err;
  }
  if (order.expiresAt && new Date(order.expiresAt).getTime() < Date.now()) {
    await expireTicketOrder(order.id);
    const err = new Error("Cet achat ticket a expire");
    err.statusCode = 400;
    throw err;
  }

  const normalizedPayerPhone = payerPhone
    ? normalizeForCountry(payerPhone, order.country?.code || "CIV")
    : "";
  if (payerPhone && !normalizedPayerPhone) {
    const err = new Error("Numero Wave invalide");
    err.statusCode = 400;
    throw err;
  }

  const amountFcfa = Number(order.totalFcfa || 0);
  if (!Number.isFinite(amountFcfa) || amountFcfa <= 0) {
    const err = new Error("Montant ticket invalide");
    err.statusCode = 400;
    throw err;
  }

  const urls = buildWaveUrls(order, req);
  const simulation = isWaveSimulationEnabled();
  const providerResponse = simulation
    ? buildSimulatedProviderResponse({ order, successUrl: urls.successUrl })
    : await paymentOrchestrator.createCheckoutSession("WAVE", {
        amountFcfa,
        successUrl: urls.successUrl,
        errorUrl: urls.errorUrl,
        clientReference: `TICKET:${order.id}`,
        restrictPayerMobile: normalizedPayerPhone || undefined,
      });
  const metadata = extractProviderMetadata(providerResponse);

  const updated = await prisma.ticketOrder.update({
    where: { id: order.id },
    data: {
      status: "PENDING_PAYMENT",
      paymentMethod: "WAVE",
      paymentProvider: "WAVE",
      paymentStatus: "PENDING_CUSTOMER_ACTION",
      providerSessionId: metadata.providerSessionId,
      providerTransactionId: metadata.providerTransactionId,
      providerCheckoutUrl: providerResponse.checkoutUrl || null,
      providerLaunchUrl: providerResponse.providerLaunchUrl || providerResponse.checkoutUrl || null,
      providerPayerPhone: metadata.providerPayerPhone || normalizedPayerPhone || null,
      providerStatusLabel:
        metadata.providerStatusLabel ||
        providerResponse.paymentStatus ||
        providerResponse.checkoutStatus ||
        null,
      providerPayloadJson: providerResponse.raw || null,
    },
    include: {
      ...paidOrderTicketInclude(),
    },
  });

  return {
    ok: true,
    simulated: simulation,
    order: updated,
    checkoutUrl: updated.providerCheckoutUrl || updated.providerLaunchUrl,
  };
}

async function expireTicketOrder(orderId) {
  return prisma.$transaction(async (tx) => {
    await tx.ticket.updateMany({
      where: { orderId, status: "RESERVED" },
      data: { status: "CANCELLED" },
    });
    return tx.ticketOrder.update({
      where: { id: orderId },
      data: { status: "EXPIRED", paymentStatus: "EXPIRED" },
    });
  });
}

async function sendTicketEmailAfterPaid({ order, req = null }) {
  try {
    const result = await sendTicketOrderEmail({
      order,
      publicUrl: publicBaseUrl(req),
    });
    if (!result?.sent && !result?.skipped) {
      console.warn("ticket email send failed", {
        orderNumber: order?.orderNumber,
        errorCode: result?.errorCode,
        errorMessage: result?.errorMessage,
      });
    }
    return result;
  } catch (error) {
    console.error("ticket email send error:", {
      orderNumber: order?.orderNumber,
      message: error?.message,
    });
    return { sent: false, skipped: false, errorMessage: error?.message };
  }
}

async function applyWaveStatusToTicketOrder({ order, providerStatusRaw, req = null }) {
  const mapped = mapWaveSessionToInternal(providerStatusRaw || {});
  const metadata = extractProviderMetadata({ raw: providerStatusRaw || {} });
  let detailsRaw = null;
  let detailsMetadata = null;

  if (!providerStatusRaw?.simulated && mapped.isFinal) {
    const lookupSessionId = firstNonEmptyString(
      metadata.providerSessionId,
      order.providerSessionId,
    );
    const lookupTransactionId = firstNonEmptyString(
      metadata.providerTransactionId,
      order.providerTransactionId,
      order.paymentReference,
    );

    if (lookupSessionId || lookupTransactionId) {
      try {
        const details = await paymentOrchestrator.getCheckoutSessionDetails("WAVE", {
          providerSessionId: lookupSessionId || null,
          providerTransactionId: lookupTransactionId || null,
        });
        detailsRaw = details?.raw || null;
        detailsMetadata = extractProviderMetadata({ raw: detailsRaw || {} });
      } catch (error) {
        console.warn("ticket wave details enrichment failed", {
          orderNumber: order.orderNumber,
          providerSessionId: lookupSessionId || null,
          providerTransactionId: lookupTransactionId || null,
          message: error?.message || String(error),
        });
      }
    }
  }

  const resolvedMetadata = {
    providerSessionId:
      detailsMetadata?.providerSessionId || metadata.providerSessionId || null,
    providerTransactionId:
      detailsMetadata?.providerTransactionId || metadata.providerTransactionId || null,
    providerPayerPhone:
      detailsMetadata?.providerPayerPhone || metadata.providerPayerPhone || null,
    providerStatusLabel:
      detailsMetadata?.providerStatusLabel || metadata.providerStatusLabel || null,
    completedAt: detailsMetadata?.completedAt || metadata.completedAt || null,
  };
  const providerPayloadForPersist = detailsRaw
    ? {
        ...providerStatusRaw,
        _wave: {
          statusPayload: providerStatusRaw,
          detailsPayload: detailsRaw,
          detailsFetchedAt: new Date().toISOString(),
        },
      }
    : providerStatusRaw;
  const now = new Date();
  const completedAtDate = resolvedMetadata.completedAt
    ? new Date(resolvedMetadata.completedAt)
    : null;
  const paidAtValue =
    mapped.markOrderPaid &&
    completedAtDate &&
    !Number.isNaN(completedAtDate.getTime())
      ? completedAtDate
      : now;
  const shouldSendTicketEmail = Boolean(mapped.markOrderPaid && order.status !== "PAID");

  const updated = await prisma.$transaction(async (tx) => {
    const data = {
      paymentProvider: "WAVE",
      paymentStatus: mapped.paymentStatus || order.paymentStatus,
      providerSessionId: resolvedMetadata.providerSessionId || order.providerSessionId,
      providerTransactionId:
        resolvedMetadata.providerTransactionId || order.providerTransactionId,
      providerPayerPhone: resolvedMetadata.providerPayerPhone || order.providerPayerPhone,
      providerStatusLabel:
        resolvedMetadata.providerStatusLabel ||
        providerStatusRaw?.payment_status ||
        providerStatusRaw?.checkout_status ||
        order.providerStatusLabel,
      providerPayloadJson: providerPayloadForPersist || order.providerPayloadJson,
    };

    if (mapped.markOrderPaid) {
      await ensureTicketsActivatedForPaidOrder(tx, order);
      data.status = "PAID";
      data.paidAt = order.paidAt || paidAtValue;
      data.paymentReference =
        resolvedMetadata.providerTransactionId ||
        providerStatusRaw?.transaction_id ||
        order.paymentReference;
    } else if (mapped.markExpired) {
      await tx.ticket.updateMany({
        where: { orderId: order.id, status: "RESERVED" },
        data: { status: "CANCELLED" },
      });
      data.status = "EXPIRED";
    } else if (mapped.markCancelled) {
      await tx.ticket.updateMany({
        where: { orderId: order.id, status: "RESERVED" },
        data: { status: "CANCELLED" },
      });
      data.status = "CANCELLED";
    }

    return tx.ticketOrder.update({
      where: { id: order.id },
      data,
      include: paidOrderTicketInclude(),
    });
  });

  if (shouldSendTicketEmail) {
    await sendTicketEmailAfterPaid({ order: updated, req });
  }

  return updated;
}

async function syncTicketWavePaymentStatus({ req, orderNumber }) {
  const order = await findTicketOrderByNumber({ req, orderNumber });
  if (!order) {
    const err = new Error("Commande billet introuvable");
    err.statusCode = 404;
    throw err;
  }
  if (!order.providerSessionId) {
    return { ok: true, order };
  }

  const providerStatusRaw = String(order.providerSessionId || "").startsWith("ticket_wave_sim_")
    ? simulatedStatusPayload(order)
    : (await paymentOrchestrator.getCheckoutSession("WAVE", {
        providerSessionId: order.providerSessionId,
      })).raw || {};

  const updated = await applyWaveStatusToTicketOrder({
    order,
    providerStatusRaw,
    req,
  });

  return { ok: true, order: updated };
}

async function syncTicketWaveOrderFromWebhook({ ticketOrderId, providerStatusRaw }) {
  const order = await prisma.ticketOrder.findUnique({
    where: { id: ticketOrderId },
    include: {
      country: { select: { code: true } },
      event: true,
      ticketType: true,
      tickets: { include: { ticketType: true } },
    },
  });
  if (!order) return null;
  return applyWaveStatusToTicketOrder({ order, providerStatusRaw });
}

module.exports = {
  initiateTicketWavePayment,
  syncTicketWavePaymentStatus,
  syncTicketWaveOrderFromWebhook,
};
