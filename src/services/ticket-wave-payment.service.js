const prisma = require("../prisma");
const inventory = require("./ticket-inventory.service");
const paymentOrchestrator = require("../payments/payment-orchestrator.service");
const {
  mapWaveSessionToInternal,
} = require("../payments/payment-status.mapper");
const { computePaymentPricing } = require("../payments/payment-pricing");
const {
  ensureTicketsActivatedForPaidOrder,
  paidOrderTicketInclude,
  signTicketOrderAccessToken,
} = require("./ticket-order-ticketing.service");
const {
  sendTicketOrderEmail,
} = require("./ticket-email-notifications.service");
const { publicFrontendBaseUrl } = require("./public-url.service");
const {
  extractWaveProviderMetadata,
  firstNonEmptyString,
} = require("../payments/wave-metadata");

function isWaveSimulationEnabled() {
  return String(process.env.ENABLE_WAVE_SIMULATION || "false") === "true";
}

function buildTicketOrderUrl(orderNumber, countryCode = "CIV", req = null) {
  const token = signTicketOrderAccessToken(orderNumber);
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : "";
  return `${publicFrontendBaseUrl(req)}/tickets/${encodeURIComponent(orderNumber)}?country=${encodeURIComponent(countryCode || "CIV")}${tokenParam}`;
}

function buildWaveUrls(order, req = null) {
  const base = buildTicketOrderUrl(
    order.orderNumber,
    order.country?.code || "CIV",
    req,
  );
  return {
    successUrl: `${base}&wave=success`,
    errorUrl: `${base}&wave=error`,
  };
}

function extractProviderMetadata(response = {}) {
  const raw = response.raw || response || {};
  const metadata = extractWaveProviderMetadata(raw);
  return {
    providerSessionId:
      response.providerSessionId || metadata.providerSessionId || null,
    providerTransactionId:
      response.providerTransactionId || metadata.providerTransactionId || null,
    providerPayerPhone:
      response.providerPayerPhone || metadata.providerPayerPhone || null,
    providerStatusLabel:
      response.providerStatusLabel || metadata.providerStatusLabel || null,
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
      orderNumber: String(orderNumber || "")
        .trim()
        .toUpperCase(),
    },
    include: {
      country: { select: { code: true } },
      event: true,
      ticketType: true,
      tickets: { include: { ticketType: true } },
    },
  });
}

async function initiateTicketWavePayment({ req, orderNumber }) {
  const snapshot = await findTicketOrderByNumber({ req, orderNumber });
  if (!snapshot) inventory.fail("Achat introuvable.", 404);
  return prisma.$transaction(
    async (tx) => {
      await inventory.lockOrder(tx, snapshot.id);
      const order = await tx.ticketOrder.findUnique({
        where: { id: snapshot.id },
        include: paidOrderTicketInclude(),
      });
      if (order.status === "PAID")
        return { ok: true, order, checkoutUrl: null, alreadyPaid: true };
      if (!["DRAFT", "PENDING_PAYMENT"].includes(order.status))
        inventory.fail(
          "Cet achat ne peut plus être payé. Retrouvez vos tickets ou démarrez un nouvel achat.",
          409,
        );
      if (order.expiresAt && new Date(order.expiresAt) <= new Date())
        inventory.fail(
          "Le délai de paiement est écoulé. Vérifiez le statut d’un paiement déjà effectué.",
          409,
        );
      const pricing = computePaymentPricing({
        paymentMode: "WAVE",
        orderTotalFcfa: order.totalFcfa,
      });
      const amountFcfa = order.amountToPayFcfa ?? pricing.amountToPayFcfa,
        paymentServiceFeeFcfa =
          order.paymentServiceFeeFcfa ?? pricing.paymentServiceFeeFcfa;
      if (!Number.isSafeInteger(amountFcfa) || amountFcfa <= 0)
        inventory.fail("Montant de paiement invalide.");
      const currentUrl = order.providerLaunchUrl || order.providerCheckoutUrl;
      if (
        order.providerSessionId &&
        currentUrl &&
        order.paymentStatus !== "FAILED"
      )
        return {
          ok: true,
          order,
          checkoutUrl: currentUrl,
          reused: true,
          paymentServiceFeeFcfa,
          amountToPayFcfa: amountFcfa,
        };
      const urls = buildWaveUrls(order, req),
        simulation = isWaveSimulationEnabled();
      const providerResponse = simulation
        ? buildSimulatedProviderResponse({ order, successUrl: urls.successUrl })
        : await paymentOrchestrator.createCheckoutSession("WAVE", {
            amountFcfa,
            successUrl: urls.successUrl,
            errorUrl: urls.errorUrl,
            clientReference: `TICKET:${order.id}`,
          });
      const metadata = extractProviderMetadata(providerResponse);
      if (!metadata.providerSessionId)
        inventory.fail(
          "Wave n’a pas pu préparer le paiement. Réessayez depuis votre achat.",
          502,
        );
      const updated = await tx.ticketOrder.update({
        where: { id: order.id },
        data: {
          paymentMethod: "WAVE",
          paymentProvider: "WAVE",
          paymentStatus: "PENDING_CUSTOMER_ACTION",
          providerSessionId: metadata.providerSessionId,
          providerTransactionId: metadata.providerTransactionId,
          providerCheckoutUrl: providerResponse.checkoutUrl || null,
          providerLaunchUrl:
            providerResponse.providerLaunchUrl ||
            providerResponse.checkoutUrl ||
            null,
          providerPayerPhone: metadata.providerPayerPhone,
          providerStatusLabel: metadata.providerStatusLabel,
          providerPayloadJson: providerResponse.raw || {},
          paymentServiceFeeFcfa,
          amountToPayFcfa: amountFcfa,
        },
        include: paidOrderTicketInclude(),
      });
      return {
        ok: true,
        simulated: simulation,
        order: updated,
        paymentServiceFeeFcfa,
        amountToPayFcfa: amountFcfa,
        checkoutUrl: updated.providerLaunchUrl || updated.providerCheckoutUrl,
      };
    },
    { timeout: 45000, maxWait: 10000 },
  );
}

async function expireTicketOrder(orderId) {
  const snapshot = await prisma.ticketOrder.findUnique({
    where: { id: orderId },
  });
  if (!snapshot) return null;
  return prisma.$transaction(async (tx) => {
    await inventory.lockEvent(tx, snapshot.eventId);
    await inventory.lockOrder(tx, orderId);
    const current = await tx.ticketOrder.findUnique({ where: { id: orderId } });
    if (!["DRAFT", "PENDING_PAYMENT"].includes(current.status)) return current;
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
      publicUrl: publicFrontendBaseUrl(req),
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

async function applyWaveStatusToTicketOrder({
  order,
  providerStatusRaw,
  req = null,
}) {
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
        const details = await paymentOrchestrator.getCheckoutSessionDetails(
          "WAVE",
          {
            providerSessionId: lookupSessionId || null,
            providerTransactionId: lookupTransactionId || null,
          },
        );
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
      detailsMetadata?.providerTransactionId ||
      metadata.providerTransactionId ||
      null,
    providerPayerPhone:
      detailsMetadata?.providerPayerPhone ||
      metadata.providerPayerPhone ||
      null,
    providerStatusLabel:
      detailsMetadata?.providerStatusLabel ||
      metadata.providerStatusLabel ||
      null,
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
  let shouldSendTicketEmail = false;

  const updated = await prisma.$transaction(async (tx) => {
    await inventory.lockEvent(tx, order.eventId);
    await inventory.lockOrder(tx, order.id);
    const current = await tx.ticketOrder.findUnique({
      where: { id: order.id },
      include: paidOrderTicketInclude(),
    });
    if (
      current.status === "PAID" &&
      (!mapped.markOrderPaid || !current.ticketIssueCode)
    )
      return current;
    if (
      ["CANCELLED", "EXPIRED"].includes(current.status) &&
      !mapped.markOrderPaid
    )
      return current;
    order = current;
    const data = {
      paymentProvider: "WAVE",
      paymentStatus: mapped.paymentStatus || order.paymentStatus,
      providerSessionId:
        resolvedMetadata.providerSessionId || order.providerSessionId,
      providerTransactionId:
        resolvedMetadata.providerTransactionId || order.providerTransactionId,
      providerPayerPhone:
        resolvedMetadata.providerPayerPhone || order.providerPayerPhone,
      providerStatusLabel:
        resolvedMetadata.providerStatusLabel ||
        providerStatusRaw?.payment_status ||
        providerStatusRaw?.checkout_status ||
        order.providerStatusLabel,
      providerPayloadJson:
        providerPayloadForPersist || order.providerPayloadJson,
    };

    if (mapped.markOrderPaid) {
      try {
        await ensureTicketsActivatedForPaidOrder(tx, order);
        data.ticketIssueCode = null;
      } catch (error) {
        if (error.code !== "CAPACITY_CONFLICT") throw error;
        data.ticketIssueCode = "CAPACITY_CONFLICT";
      }
      shouldSendTicketEmail =
        !data.ticketIssueCode &&
        (current.status !== "PAID" || !!current.ticketIssueCode);
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

async function repairPaidTickets(order){
 let notify=false;
 const updated=await prisma.$transaction(async tx=>{
   await inventory.lockEvent(tx,order.eventId);await inventory.lockOrder(tx,order.id);
   const current=await tx.ticketOrder.findUnique({where:{id:order.id},include:paidOrderTicketInclude()});
   if(current.status!=='PAID')return current;
   const count=current.tickets.filter(t=>['ACTIVE','USED'].includes(t.status)).length;
   if(count>=current.quantity&&!current.ticketIssueCode)return current;
   let ticketIssueCode=null;
   try{await ensureTicketsActivatedForPaidOrder(tx,current);notify=count<current.quantity;}
   catch(error){if(error.code!=='CAPACITY_CONFLICT')throw error;ticketIssueCode=error.code;}
   return tx.ticketOrder.update({where:{id:current.id},data:{ticketIssueCode},include:paidOrderTicketInclude()});
 });
 if(notify)await sendTicketEmailAfterPaid({order:updated});
 return updated;
}
async function syncTicketWavePaymentStatus({ req, orderNumber }) {
  const order = await findTicketOrderByNumber({ req, orderNumber });
  if (!order) {
    const err = new Error("Commande billet introuvable");
    err.statusCode = 404;
    throw err;
  }
  if(order.status==='PAID')return {ok:true,order:await repairPaidTickets(order)};
  if (!order.providerSessionId) {
    return { ok: true, order };
  }

  const providerStatusRaw = String(order.providerSessionId || "").startsWith(
    "ticket_wave_sim_",
  )
    ? simulatedStatusPayload(order)
    : (
        await paymentOrchestrator.getCheckoutSession("WAVE", {
          providerSessionId: order.providerSessionId,
        })
      ).raw || {};

  const updated = await applyWaveStatusToTicketOrder({
    order,
    providerStatusRaw,
    req,
  });

  return { ok: true, order: updated };
}

async function syncTicketWaveOrderFromWebhook({
  ticketOrderId,
  providerStatusRaw,
}) {
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
  expireTicketOrder,
};
