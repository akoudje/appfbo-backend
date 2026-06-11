const prisma = require("../prisma");
const paymentOrchestrator = require("../payments/payment-orchestrator.service");
const { mapWaveSessionToInternal } = require("../payments/payment-status.mapper");

function publicExternalPaymentUrl(token, req = null) {
  const configured = String(
    process.env.PUBLIC_APP_URL ||
      process.env.APP_PUBLIC_BASE_URL ||
      process.env.FRONTEND_URL ||
      "",
  ).trim();
  const rawBase = configured || (req ? `${req.protocol}://${req.get("host")}` : "");
  const base = /^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`;
  return `${base.replace(/\/+$/, "")}/external-payment/${encodeURIComponent(token)}`;
}

function buildWaveUrls(link, req = null) {
  const base = publicExternalPaymentUrl(link.token, req);
  return {
    successUrl: `${base}?wave=success`,
    errorUrl: `${base}?wave=error`,
  };
}

function extractProviderMetadata(response = {}) {
  const raw = response.raw || {};
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

async function initiateExternalWavePayment({ req, token }) {
  const link = await prisma.externalPaymentLink.findFirst({
    where: { token: String(token || "").trim(), countryId: req.countryId },
    include: { country: true },
  });
  if (!link) {
    const err = new Error("Lien de paiement introuvable");
    err.statusCode = 404;
    throw err;
  }
  if (link.status !== "ACTIVE") {
    const err = new Error("Ce lien n'est plus actif");
    err.statusCode = 400;
    throw err;
  }
  if (link.expiresAt && new Date(link.expiresAt).getTime() < Date.now()) {
    await prisma.externalPaymentLink.update({
      where: { id: link.id },
      data: { status: "EXPIRED", providerStatus: "EXPIRED" },
    });
    const err = new Error("Ce lien de paiement a expiré");
    err.statusCode = 400;
    throw err;
  }

  const urls = buildWaveUrls(link, req);
  const clientReference = link.id;
  const providerResponse = await paymentOrchestrator.createCheckoutSession("WAVE", {
    amountFcfa: link.amountFcfa,
    successUrl: urls.successUrl,
    errorUrl: urls.errorUrl,
    clientReference,
  });
  const metadata = extractProviderMetadata(providerResponse);

  const updated = await prisma.externalPaymentLink.update({
    where: { id: link.id },
    data: {
      provider: "WAVE",
      providerStatus: "PENDING_CUSTOMER_ACTION",
      providerSessionId: metadata.providerSessionId,
      providerTransactionId: metadata.providerTransactionId,
      providerCheckoutUrl: providerResponse.checkoutUrl || null,
      providerLaunchUrl: providerResponse.providerLaunchUrl || providerResponse.checkoutUrl || null,
      providerPayerPhone: metadata.providerPayerPhone || null,
      providerStatusLabel:
        metadata.providerStatusLabel ||
        providerResponse.paymentStatus ||
        providerResponse.checkoutStatus ||
        null,
      providerPayloadJson: providerResponse.raw || null,
      updatedById: req.user?.id || null,
    },
  });

  return {
    ok: true,
    link: updated,
    checkoutUrl: updated.providerCheckoutUrl || updated.providerLaunchUrl,
  };
}

async function syncExternalWaveLinkFromSession({ link, providerStatusRaw }) {
  const mapped = mapWaveSessionToInternal(providerStatusRaw || {});
  const metadata = extractProviderMetadata({ raw: providerStatusRaw || {} });
  const nextData = {
    providerStatus: mapped.paymentStatus || link.providerStatus,
    providerSessionId: metadata.providerSessionId || link.providerSessionId,
    providerTransactionId: metadata.providerTransactionId || link.providerTransactionId,
    providerPayerPhone: metadata.providerPayerPhone || link.providerPayerPhone,
    providerStatusLabel:
      metadata.providerStatusLabel ||
      providerStatusRaw?.payment_status ||
      providerStatusRaw?.checkout_status ||
      link.providerStatusLabel,
    providerPayloadJson: providerStatusRaw || link.providerPayloadJson,
  };

  if (mapped.paymentStatus === "SUCCEEDED") {
    nextData.status = "PAID";
    nextData.paidAt = link.paidAt || new Date();
  } else if (mapped.paymentStatus === "EXPIRED") {
    nextData.status = "EXPIRED";
  } else if (mapped.paymentStatus === "CANCELLED") {
    nextData.status = "CANCELLED";
    nextData.cancelledAt = link.cancelledAt || new Date();
  }

  return prisma.externalPaymentLink.update({
    where: { id: link.id },
    data: nextData,
  });
}

async function syncExternalWavePaymentStatus({ req, token }) {
  const link = await prisma.externalPaymentLink.findFirst({
    where: { token: String(token || "").trim(), countryId: req.countryId },
  });
  if (!link) {
    const err = new Error("Lien de paiement introuvable");
    err.statusCode = 404;
    throw err;
  }
  if (!link.providerSessionId) {
    return { ok: true, link };
  }

  const providerStatus = await paymentOrchestrator.getCheckoutSession("WAVE", {
    providerSessionId: link.providerSessionId,
  });
  const updated = await syncExternalWaveLinkFromSession({
    link,
    providerStatusRaw: providerStatus.raw || {},
  });

  return { ok: true, link: updated };
}

async function syncExternalWavePaymentLink(link) {
  if (!link) {
    const err = new Error("Lien de paiement introuvable");
    err.statusCode = 404;
    throw err;
  }
  if (!link.providerSessionId) {
    return { ok: true, link };
  }

  const providerStatus = await paymentOrchestrator.getCheckoutSession("WAVE", {
    providerSessionId: link.providerSessionId,
  });
  const updated = await syncExternalWaveLinkFromSession({
    link,
    providerStatusRaw: providerStatus.raw || {},
  });

  return { ok: true, link: updated };
}

module.exports = {
  initiateExternalWavePayment,
  syncExternalWavePaymentStatus,
  syncExternalWavePaymentLink,
  syncExternalWaveLinkFromSession,
};
