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
    successUrl: `${base}?wave=success&country=${encodeURIComponent(link.country?.code || req?.country?.code || "CIV")}`,
    errorUrl: `${base}?wave=error&country=${encodeURIComponent(link.country?.code || req?.country?.code || "CIV")}`,
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

// Frais d'expédition : une session Wave expirée (ou abandonnée) ne doit pas
// tuer la demande de paiement. Le client garde le même lien ; la session est
// simplement oubliée et une nouvelle sera créée au prochain clic « Payer ».
// Avant ce correctif, l'expiration de la session marquait tout le lien
// EXPIRED : le client recevait un lien mort, même après un renvoi.
const SHIPPING_SESSION_RESET_DATA = Object.freeze({
  status: "ACTIVE",
  providerStatus: "INITIATED",
  providerSessionId: null,
  providerCheckoutUrl: null,
  providerLaunchUrl: null,
  providerStatusLabel: null,
});

// Lien d'expédition expiré à cause de Wave (pas d'échéance propre au lien,
// commande toujours en attente de ces frais) : remis en service.
async function reviveExpiredShippingLink(link, db = prisma) {
  if (!link || link.source !== "SHIPPING" || link.status !== "EXPIRED" || link.providerStatus !== "EXPIRED") return link;
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()) return link;
  const order = await db.preorder.findFirst({
    where: {
      shippingPaymentLinkId: link.id,
      countryId: link.countryId,
      paymentStatus: "PAID",
      status: { in: ["PAID", "READY"] },
    },
    select: { shippingFeeFcfa: true },
  });
  if (!order || order.shippingFeeFcfa !== link.baseAmountFcfa) return link;
  await db.externalPaymentLink.updateMany({
    where: { id: link.id, status: "EXPIRED", providerStatus: "EXPIRED", providerSessionId: link.providerSessionId },
    data: SHIPPING_SESSION_RESET_DATA,
  });
  return db.externalPaymentLink.findUnique({ where: { id: link.id }, include: link.country ? { country: true } : undefined });
}

// Un lien de paiement hors précommande (EXT, QR, frais d'expédition) est
// valable 3 h au maximum après sa création (règle du 2026-11-10).
const { PAYMENT_LINK_TTL_MS } = require("../payments/payment-link-window");
const { closeWaveCheckoutSession } = require("../payments/wave-session-close");

function capExternalLinkExpiry(requested = null, now = new Date()) {
  const max = new Date(now.getTime() + PAYMENT_LINK_TTL_MS);
  if (!requested) return max;
  const date = new Date(requested);
  if (Number.isNaN(date.getTime())) return max;
  return date.getTime() < max.getTime() ? date : max;
}

// Session Wave du lien encore ouverte et récente : reprise telle quelle.
const EXTERNAL_SESSION_REUSE_MS = 20 * 60 * 1000;
function isReusableExternalSession(link, now = new Date()) {
  if (!link?.providerSessionId || !(link.providerCheckoutUrl || link.providerLaunchUrl)) return false;
  if (!["PENDING_CUSTOMER_ACTION", "PROCESSING"].includes(String(link.providerStatus || ""))) return false;
  const age = now.getTime() - new Date(link.updatedAt || 0).getTime();
  return age >= 0 && age < EXTERNAL_SESSION_REUSE_MS;
}

// Lien arrivé à échéance (ou ancien lien sans échéance créé il y a plus de
// 3 h) : sa session Wave est fermée et le lien passe « Expiré ». Une session
// payée est synchronisée à la place ; une session en cours de paiement est
// laissée en l'état.
async function expireExternalLinkIfDue(link, now = new Date()) {
  if (!link || link.status !== "ACTIVE") return { link, expired: false };
  const dueAt = link.expiresAt
    ? new Date(link.expiresAt)
    : new Date(new Date(link.createdAt).getTime() + PAYMENT_LINK_TTL_MS);
  if (dueAt.getTime() > now.getTime()) return { link, expired: false };
  const outcome = await closeWaveCheckoutSession(link.providerSessionId);
  if (outcome.paid) {
    await syncExternalWavePaymentLink(link);
    return { link, expired: false, paid: true };
  }
  if (!outcome.closed) return { link, expired: false };
  await prisma.externalPaymentLink.updateMany({
    where: { id: link.id, status: "ACTIVE" },
    data: { status: "EXPIRED", providerStatus: "EXPIRED", expiresAt: link.expiresAt || dueAt },
  });
  return { link: { ...link, status: "EXPIRED", providerStatus: "EXPIRED", expiresAt: link.expiresAt || dueAt }, expired: true };
}

async function expireDueExternalLinks({ now = new Date() } = {}) {
  const links = await prisma.externalPaymentLink.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { expiresAt: { lte: now } },
        { expiresAt: null, createdAt: { lte: new Date(now.getTime() - PAYMENT_LINK_TTL_MS) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  const summary = { checked: links.length, expired: 0 };
  for (const link of links) {
    try {
      const result = await expireExternalLinkIfDue(link, now);
      if (result.expired) summary.expired += 1;
    } catch (error) {
      console.error("[external-wave] expiration du lien impossible", { linkId: link.id, message: error?.message });
    }
  }
  return summary;
}

async function initiateExternalWavePayment({ req, token }) {
  let link = await prisma.externalPaymentLink.findFirst({
    where: { token: String(token || "").trim(), countryId: req.countryId },
    include: { country: true },
  });
  if (!link) {
    const err = new Error("Lien de paiement introuvable");
    err.statusCode = 404;
    throw err;
  }
  link = await reviveExpiredShippingLink(link);
  if (link.source === "SHIPPING" && link.status === "ACTIVE" && link.providerSessionId) {
    // Session Wave déjà ouverte : on vérifie qu'elle est encore utilisable
    // avant d'y renvoyer le client (sinon il tombe sur une page Wave expirée).
    try {
      const current = await paymentOrchestrator.getCheckoutSession("WAVE", { providerSessionId: link.providerSessionId });
      await syncExternalWaveLinkFromSession({ link, providerStatusRaw: current.raw || {} });
      link = await prisma.externalPaymentLink.findUnique({ where: { id: link.id }, include: { country: true } });
    } catch (error) {
      console.warn("[external-wave] shipping session check failed", { linkId: link.id, message: error?.message });
    }
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

  // Un seul paiement par lien, une seule session Wave ouverte : la session en
  // cours est reprise, sinon l'ancienne est fermée avant d'en ouvrir une autre.
  if (link.source !== 'SHIPPING' && link.providerSessionId) {
    if (isReusableExternalSession(link)) {
      return { ok: true, reused: true, link, checkoutUrl: link.providerCheckoutUrl || link.providerLaunchUrl };
    }
    const outcome = await closeWaveCheckoutSession(link.providerSessionId);
    if (outcome.paid || outcome.processing) {
      if (outcome.paid) await syncExternalWavePaymentLink(link).catch(() => {});
      const err = new Error(
        outcome.paid
          ? "Ce lien a déjà été payé. Le paiement est en cours de confirmation."
          : "Un paiement Wave est en cours sur ce lien. Patientez quelques minutes avant de réessayer.",
      );
      err.statusCode = 409;
      throw err;
    }
  }

  if (link.source === 'SHIPPING') {
    const order = await prisma.preorder.findFirst({ where: { shippingPaymentLinkId: link.id, countryId: link.countryId, paymentStatus: 'PAID', status: { in: ['PAID', 'READY'] } } });
    if (!order || order.shippingFeeFcfa !== link.baseAmountFcfa) { const error = new Error('Cette demande de frais d’expédition n’est plus active.'); error.statusCode = 409; throw error; }
    if (link.providerSessionId && link.providerCheckoutUrl) return { ok: true, link, checkoutUrl: link.providerCheckoutUrl };
    const claim = await prisma.externalPaymentLink.updateMany({ where: { id: link.id, status: 'ACTIVE', providerSessionId: null, providerStatus: { in: ['INITIATED', 'FAILED'] } }, data: { providerStatus: 'PROCESSING' } });
    if (!claim.count) { const error = new Error('Le paiement est déjà en cours. Actualisez cette page.'); error.statusCode = 409; throw error; }
  }
  const urls = buildWaveUrls(link, req);
  const clientReference = link.id;
  let providerResponse;
  try { providerResponse = await paymentOrchestrator.createCheckoutSession("WAVE", {
    amountFcfa: link.amountFcfa,
    successUrl: urls.successUrl,
    errorUrl: urls.errorUrl,
    clientReference,
  }); } catch (error) {
    if (link.source === 'SHIPPING') await prisma.externalPaymentLink.updateMany({ where: { id: link.id, status: 'ACTIVE', providerStatus: 'PROCESSING', providerSessionId: null }, data: { providerStatus: 'FAILED' } });
    throw error;
  }
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
  if (link.source === 'SHIPPING') {
    // Read current state: webhook retries and late events must never downgrade a paid quote.
    link = await prisma.externalPaymentLink.findUnique({ where: { id: link.id } });
    if (!link || link.status === 'PAID' || link.status === 'CANCELLED') return link;
    let session = providerStatusRaw || {};
    // Événement d'une ancienne session (lien renouvelé depuis) : ignoré, il ne
    // doit ni réinitialiser ni expirer la session en cours.
    const eventSessionId = session.id || session.checkout_session_id || session.checkout_session?.id || null;
    // (Une confirmation de paiement d’une autre session reste rejetée plus bas.)
    const claimsPaid = session.payment_status === "succeeded" || session.checkout_status === "complete";
    if (!claimsPaid && eventSessionId && link.providerSessionId && String(eventSessionId) !== String(link.providerSessionId)) return link;
    if (session.payment_status === 'succeeded' || session.checkout_status === 'complete') {
      if ((session.amount == null || !session.currency || !session.client_reference) && link.providerSessionId) {
        const verified = await paymentOrchestrator.getCheckoutSession('WAVE', { providerSessionId: link.providerSessionId });
        session = verified.raw || {};
        providerStatusRaw = session;
      }
      if (session.payment_status !== 'succeeded' || String(session.id || '') !== String(link.providerSessionId || '') || !link.providerSessionId || Number(session.amount) !== link.amountFcfa || session.currency !== link.currencyCode || String(session.client_reference || '') !== link.id) {
        const error = new Error('Confirmation d’expédition incohérente : session, montant ou devise incorrects.'); error.statusCode = 409; throw error;
      }
    }
  }
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

  if (link.source === 'SHIPPING') {
    // Session expirée ou abandonnée côté Wave : le lien reste valable, seule
    // la session est oubliée (voir SHIPPING_SESSION_RESET_DATA).
    const sessionDead = ["EXPIRED", "CANCELLED", "FAILED"].includes(mapped.paymentStatus);
    await prisma.externalPaymentLink.updateMany({
      where: { id: link.id, providerSessionId: link.providerSessionId, status: { notIn: ['PAID', 'CANCELLED'] } },
      data: sessionDead
        ? { ...SHIPPING_SESSION_RESET_DATA, providerPayloadJson: providerStatusRaw || link.providerPayloadJson }
        : nextData,
    });
    return prisma.externalPaymentLink.findUnique({ where: { id: link.id } });
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
  reviveExpiredShippingLink,
  capExternalLinkExpiry,
  expireExternalLinkIfDue,
  expireDueExternalLinks,
  isReusableExternalSession,
  initiateExternalWavePayment,
  syncExternalWavePaymentStatus,
  syncExternalWavePaymentLink,
  syncExternalWaveLinkFromSession,
};
