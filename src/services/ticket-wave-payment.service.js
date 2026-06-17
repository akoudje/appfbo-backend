const prisma = require("../prisma");
const paymentOrchestrator = require("../payments/payment-orchestrator.service");
const { mapWaveSessionToInternal } = require("../payments/payment-status.mapper");
const { normalizeForCountry } = require("../utils/phone");

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
  return {
    providerSessionId:
      response.providerSessionId ||
      raw.id ||
      raw.checkout_session_id ||
      raw.checkout_session?.id ||
      null,
    providerTransactionId:
      response.providerTransactionId ||
      raw.transaction_id ||
      raw.checkout_session?.transaction_id ||
      null,
    providerPayerPhone:
      response.providerPayerPhone ||
      raw.payer_phone ||
      raw.customer_msisdn ||
      raw.checkout_session?.payer_phone ||
      null,
    providerStatusLabel:
      response.providerStatusLabel ||
      raw.checkout_status_label ||
      raw.payment_status_label ||
      raw.checkout_session?.checkout_status_label ||
      null,
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
      country: { select: { code: true } },
      event: true,
      tickets: { include: { ticketType: true } },
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

async function applyWaveStatusToTicketOrder({ order, providerStatusRaw }) {
  const mapped = mapWaveSessionToInternal(providerStatusRaw || {});
  const metadata = extractProviderMetadata({ raw: providerStatusRaw || {} });
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const data = {
      paymentProvider: "WAVE",
      paymentStatus: mapped.paymentStatus || order.paymentStatus,
      providerSessionId: metadata.providerSessionId || order.providerSessionId,
      providerTransactionId: metadata.providerTransactionId || order.providerTransactionId,
      providerPayerPhone: metadata.providerPayerPhone || order.providerPayerPhone,
      providerStatusLabel:
        metadata.providerStatusLabel ||
        providerStatusRaw?.payment_status ||
        providerStatusRaw?.checkout_status ||
        order.providerStatusLabel,
      providerPayloadJson: providerStatusRaw || order.providerPayloadJson,
    };

    if (mapped.markOrderPaid) {
      await tx.ticket.updateMany({
        where: { orderId: order.id, status: "RESERVED" },
        data: { status: "ACTIVE" },
      });
      data.status = "PAID";
      data.paidAt = order.paidAt || now;
      data.paymentReference =
        metadata.providerTransactionId ||
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
      include: {
        country: { select: { code: true } },
        event: true,
        tickets: { include: { ticketType: true } },
      },
    });
  });
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
  });

  return { ok: true, order: updated };
}

async function syncTicketWaveOrderFromWebhook({ ticketOrderId, providerStatusRaw }) {
  const order = await prisma.ticketOrder.findUnique({
    where: { id: ticketOrderId },
    include: {
      country: { select: { code: true } },
      event: true,
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
