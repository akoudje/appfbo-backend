const crypto = require('crypto');
const { PreorderLogAction } = require('@prisma/client');

const SHIPPING_MODES = new Set(['EXPEDITION_POSTE', 'EXPEDITION_CODITRANS']);
const isShipping = mode => SHIPPING_MODES.has(mode);
const carrierLabel = mode => mode === 'EXPEDITION_POSTE' ? 'La Poste' : 'Coditrans';
function fail(message, statusCode = 400) { const error = new Error(message); error.statusCode = statusCode; throw error; }

function recipientInput(body, mode, countryCode = 'CIV') {
  if (!isShipping(mode)) return { shippingRecipientName: null, shippingRecipientPhone: null, shippingDestinationCity: null };
  const text = (value, min) => {
    if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) return '';
    const clean = value.trim().replace(/\s+/g, ' ');
    return clean.length >= min && clean.length <= 120 ? clean : '';
  };
  const shippingRecipientName = text(body.shippingRecipientName, 3);
  const shippingDestinationCity = text(body.shippingDestinationCity, 2);
  const raw = typeof body.shippingRecipientPhone === 'string' ? body.shippingRecipientPhone.trim() : '';
  const configs = { CIV: ['225', 10], BFA: ['226', 8], BEN: ['229', 8], TGO: ['228', 8], NER: ['227', 8] };
  const [prefix, length] = configs[countryCode] || configs.CIV;
  let digits = raw.replace(/[\s().-]/g, '');
  if (digits.startsWith('00')) digits = '+' + digits.slice(2);
  if (new RegExp(`^${prefix}\\d{${length}}$`).test(digits)) digits = '+' + digits;
  if (new RegExp(`^\\d{${length}}$`).test(digits)) digits = '+' + prefix + digits;
  const shippingRecipientPhone = /^\+[1-9]\d{7,14}$/.test(digits) ? digits : '';
  if (!shippingRecipientName || !shippingRecipientPhone || !shippingDestinationCity) fail('Renseignez le nom complet, un téléphone valide et la ville du destinataire.');
  return { shippingRecipientName, shippingRecipientPhone, shippingDestinationCity };
}

function quoteInput(body, mode) {
  if (!isShipping(mode)) fail('Cette commande ne nécessite pas de frais d’expédition.');
  const amount = body.shippingFeeFcfa;
  if (!['string', 'number'].includes(typeof amount)) fail('Le montant des frais d’expédition est invalide.');
  if (amount === '' || amount == null || typeof amount === 'boolean' || (typeof amount === 'string' && !/^\d+$/.test(amount.trim())) || !Number.isSafeInteger(Number(amount)) || Number(amount) < 0 || Number(amount) > 2147483647) fail('Saisissez un montant entier de frais d’expédition, éventuellement zéro.');
  const weight = Number(body.shippingWeightKg);
  const count = Number(body.shippingParcelCount);
  if (mode === 'EXPEDITION_POSTE' && !['string', 'number'].includes(typeof body.shippingWeightKg)) fail('Le poids final du colis est invalide.');
  if (mode === 'EXPEDITION_CODITRANS' && !['string', 'number'].includes(typeof body.shippingParcelCount)) fail('Le nombre de cartons est invalide.');
  if (mode === 'EXPEDITION_POSTE' && (typeof body.shippingWeightKg === 'boolean' || !Number.isFinite(weight) || weight <= 0 || weight > 999999 || Math.round(weight * 1000) / 1000 !== weight)) fail('Saisissez le poids final du colis en kg (trois décimales au maximum).');
  if (mode === 'EXPEDITION_CODITRANS' && (typeof body.shippingParcelCount === 'boolean' || !Number.isSafeInteger(count) || count < 1 || count > 999)) fail('Saisissez le nombre réel de cartons (1 à 999).');
  return { shippingFeeFcfa: Number(amount), shippingWeightKg: mode === 'EXPEDITION_POSTE' ? weight : null, shippingParcelCount: mode === 'EXPEDITION_CODITRANS' ? count : null };
}

function shippingPaymentSummary(order) {
  const link = order.shippingPaymentLink;
  if (!isShipping(order.deliveryMode)) return null;
  const paid = order.shippingFeeFcfa === 0 || Boolean(link && link.source === 'SHIPPING' && link.status === 'PAID' && link.providerStatus === 'SUCCEEDED' && link.baseAmountFcfa === order.shippingFeeFcfa && link.countryId === order.countryId);
  return {
    status: order.shippingFeeFcfa == null ? 'TO_QUOTE' : paid ? 'PAID' : 'TO_PAY',
    feeFcfa: order.shippingFeeFcfa,
    serviceFeeFcfa: link?.serviceFeeFcfa || 0,
    amountToPayFcfa: link?.amountFcfa ?? order.shippingFeeFcfa,
    path: !paid && link?.status === 'ACTIVE' && link.token ? `/external-payment/${encodeURIComponent(link.token)}?country=${encodeURIComponent(order.country?.code || 'CIV')}` : null,
  };
}

async function assertShippingPaid(tx, order) {
  if (!isShipping(order.deliveryMode)) return;
  order = await tx.preorder.findUnique({ where: { id: order.id } });
  if (order.paymentStatus !== 'PAID') fail('Le paiement des produits doit être confirmé avant l’expédition.', 409);
  const link = order.shippingPaymentLinkId ? await tx.externalPaymentLink.findUnique({ where: { id: order.shippingPaymentLinkId } }) : null;
  if (shippingPaymentSummary({ ...order, shippingPaymentLink: link }).status !== 'PAID') fail('Les frais d’expédition doivent être fixés puis payés avant de remettre le colis au transporteur.', 409);
}

async function assertShippingQuoted(tx, order) {
  if (!isShipping(order.deliveryMode)) return;
  const current = await tx.preorder.findUnique({ where: { id: order.id } });
  if (current.shippingFeeFcfa == null) fail('Fixez les frais d’expédition du colis avant de le marquer prêt.', 409);
}

async function setShippingQuote(tx, order, body, actorId) {
  if (!['PAID', 'READY'].includes(order.status) || order.paymentStatus !== 'PAID' || !order.preparationLaunchedAt) fail('Les frais se déterminent après le lancement de la préparation d’une commande payée.', 409);
  const data = quoteInput(body, order.deliveryMode);
  recipientInput(order, order.deliveryMode, order.country?.code);
  const lines = await tx.preparationChecklistItem.findMany({ where: { preorderId: order.id } });
  if (!lines.length || !lines.every(line => line.checked) || await tx.preparationAnomaly.count({ where: { preorderId: order.id, blocking: true, resolvedAt: null } })) fail('Terminez la vérification du colis et résolvez les anomalies avant de fixer les frais.', 409);
  const existing = order.shippingPaymentLinkId ? await tx.externalPaymentLink.findUnique({ where: { id: order.shippingPaymentLinkId } }) : null;
  const expired = existing?.status === 'EXPIRED' && existing?.providerStatus === 'EXPIRED';
  const unchanged = order.shippingFeeFcfa != null && order.shippingFeeFcfa === data.shippingFeeFcfa &&
    (data.shippingWeightKg == null ? order.shippingWeightKg == null : Number(order.shippingWeightKg) === data.shippingWeightKg) &&
    (data.shippingParcelCount == null ? order.shippingParcelCount == null : order.shippingParcelCount === data.shippingParcelCount);
  const reusable = data.shippingFeeFcfa === 0 ? !existing : existing?.source === 'SHIPPING' && existing.countryId === order.countryId && existing.baseAmountFcfa === data.shippingFeeFcfa && ['ACTIVE', 'PAID'].includes(existing.status) && (!existing.expiresAt || new Date(existing.expiresAt) > new Date());
  if (unchanged && reusable) {
    const saved = await tx.preorder.findUnique({ where: { id: order.id }, include: { shippingPaymentLink: true, country: { select: { code: true } }, messages: { where: { purpose: 'PAYMENT_LINK' }, orderBy: { createdAt: 'desc' }, take: 20 } } });
    return { ...saved, shippingQuoteUnchanged: true };
  }
  if ((!expired && existing?.providerSessionId) || existing?.providerStatus === 'PROCESSING' || existing?.status === 'PAID') fail('Un paiement a déjà été lancé pour ces frais. Le montant ne peut plus être modifié.', 409);
  if (data.shippingFeeFcfa > 0 && order.country?.settings?.enableWave === false) fail('Le paiement Wave des frais d’expédition n’est pas activé pour ce pays.', 409);
  const changed = await tx.preorder.updateMany({ where: { id: order.id, countryId: order.countryId, status: order.status, updatedAt: order.updatedAt }, data: { updatedAt: new Date() } });
  if (changed.count !== 1) fail('La commande a changé. Actualisez le dossier.', 409);
  // Lock the old link too: an initiation cannot attach a session to a superseded quote.
  if (existing) {
    const cancelled = await tx.externalPaymentLink.updateMany({ where: { id: existing.id, providerSessionId: expired ? existing.providerSessionId : null, providerStatus: { in: ['INITIATED', 'FAILED', 'EXPIRED'] }, status: { in: ['ACTIVE', 'CANCELLED', 'EXPIRED'] } }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    if (!cancelled.count) fail('Le paiement vient de démarrer. Actualisez le dossier.', 409);
    if (existing.token) await tx.orderMessage.updateMany({
      where: { preorderId: order.id, purpose: 'PAYMENT_LINK', channel: 'SMS', status: 'QUEUED', processingStartedAt: null, paymentLinkTarget: { contains: `/external-payment/${encodeURIComponent(existing.token)}` } },
      data: { status: 'FAILED', nextAttemptAt: null, errorCode: 'SHIPPING_QUOTE_REPLACED', errorMessage: 'Demande de paiement remplacée par un nouveau devis.', failedAt: new Date(), lastStatusAt: new Date() },
    });
  }
  let shippingPaymentLinkId = null;
  if (data.shippingFeeFcfa > 0) {
    const serviceFeeFcfa = Math.ceil(data.shippingFeeFcfa * 0.01);
    if (data.shippingFeeFcfa + serviceFeeFcfa > 2147483647) fail('Le montant est trop élevé.');
    const link = await tx.externalPaymentLink.create({ data: {
      countryId: order.countryId, token: crypto.randomBytes(24).toString('base64url'),
      reference: `EXP-${order.preorderNumber || order.id}-${crypto.randomBytes(4).toString('hex')}`,
      source: 'SHIPPING', externalReference: order.id, customerName: order.fboNomComplet,
      baseAmountFcfa: data.shippingFeeFcfa, serviceFeeFcfa, amountFcfa: data.shippingFeeFcfa + serviceFeeFcfa,
      title: `Expédition ${carrierLabel(order.deliveryMode)}`, description: `Frais d’expédition de la précommande ${order.preorderNumber || order.id}. La facture des produits est déjà réglée.`,
      instructions: 'Ce paiement couvre uniquement l’expédition. Revenez dans votre espace client après le règlement.',
      paymentMethod: 'WAVE', createdById: actorId, updatedById: actorId,
    } });
    shippingPaymentLinkId = link.id;
  }
  const saved = await tx.preorder.update({ where: { id: order.id }, data: { ...data, shippingPaymentLinkId, shippingQuotedAt: new Date(), shippingQuotedById: actorId }, include: { shippingPaymentLink: true, country: { select: { code: true } } } });
  // REPRICE is already supported by both Prisma and the deployed database.
  // The event identifies shipping tariff changes without modifying product totals.
  await tx.preorderLog.create({ data: { preorderId: order.id, action: PreorderLogAction.REPRICE, note: 'Frais d’expédition déterminés par le préparateur', actorAdminId: actorId, meta: { event: 'SHIPPING_QUOTE', ...data } } });
  return saved;
}

module.exports = { isShipping, carrierLabel, recipientInput, quoteInput, shippingPaymentSummary, assertShippingPaid, assertShippingQuoted, setShippingQuote };
