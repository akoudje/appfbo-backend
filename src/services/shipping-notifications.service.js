const prisma = require('../prisma');
const { isShipping, carrierLabel } = require('./shipping.service');
const { sendPreorderNotification } = require('./preorder-notifications.service');

function paymentUrl(order) {
  const raw = process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_BASE_URL || process.env.FRONTEND_PUBLIC_URL || process.env.FRONTEND_URL || 'https://forevercivstore.com';
  const base = new URL(raw);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Adresse publique de paiement invalide');
  return `${base.href.replace(/\/+$/, '')}/external-payment/${encodeURIComponent(order.shippingPaymentLink.token)}?country=${encodeURIComponent(order.country?.code || 'CIV')}`;
}

function notificationSummary(order) {
  if (!isShipping(order?.deliveryMode) || order.shippingFeeFcfa == null) return null;
  if (order.shippingFeeFcfa === 0) return { status: 'NOT_REQUIRED', message: 'Expédition offerte : aucun paiement à demander.', channels: [] };
  if (order.shippingPaymentLink?.status === 'PAID' && order.shippingPaymentLink?.providerStatus === 'SUCCEEDED') return { status: 'NOT_REQUIRED', message: 'Les frais d’expédition sont déjà réglés.', channels: [] };
  const token = order.shippingPaymentLink?.token;
  const messages = (order.messages || []).filter(message => token && message.purpose === 'PAYMENT_LINK' && String(message.paymentLinkTarget || '').includes(`/external-payment/${encodeURIComponent(token)}`));
  const channels = ['EMAIL', 'SMS'].map(channel => {
    const latest = messages.filter(message => message.channel === channel).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    return { channel, status: latest?.status || 'NOT_SENT', sentAt: latest?.sentAt || null, createdAt: latest?.createdAt || null };
  });
  const accepted = channels.some(item => ['SENT', 'DELIVERED', 'READ', 'QUEUED'].includes(item.status));
  const failed = channels.some(item => item.status === 'FAILED');
  const queued = channels.some(item => item.status === 'QUEUED');
  const status = failed && accepted ? 'PARTIAL' : queued ? 'QUEUED' : accepted ? 'SENT' : failed ? 'FAILED' : 'NONE';
  const descriptions = { SENT: 'envoyé', DELIVERED: 'livré', READ: 'lu', QUEUED: 'en file d’envoi', FAILED: 'envoi échoué', NOT_SENT: 'non envoyé' };
  const message = status === 'NONE' ? 'Aucune notification de paiement enregistrée. Utilisez « Notifier le client ».' : channels.map(item => `${item.channel === 'EMAIL' ? 'Email' : 'SMS'} : ${descriptions[item.status] || 'en attente'}`).join(' · ');
  return { status, message, channels };
}

function withShippingNotification(order) {
  if (!order) return order;
  const result = { ...order, shippingNotification: notificationSummary(order) };
  delete result.shippingQuoteUnchanged;
  if (order.shippingPaymentLink) result.shippingPaymentLink = Object.fromEntries(['providerSessionId', 'status', 'providerStatus', 'baseAmountFcfa', 'amountFcfa', 'serviceFeeFcfa'].filter(key => order.shippingPaymentLink[key] !== undefined).map(key => [key, order.shippingPaymentLink[key]]));
  return result;
}

async function notifyShippingPayment({ orderId, countryId, actorName = 'SYSTEM' }) {
  const order = await prisma.preorder.findFirst({ where: { id: orderId, countryId }, include: { shippingPaymentLink: true, country: { select: { code: true } }, fbo: { select: { email: true } } } });
  if (!order) { const error = new Error('Commande introuvable.'); error.statusCode = 404; throw error; }
  const link = order.shippingPaymentLink;
  if (!isShipping(order.deliveryMode) || order.shippingFeeFcfa == null || !['PAID', 'READY'].includes(order.status) || order.paymentStatus !== 'PAID') { const error = new Error('La demande de paiement d’expédition n’est pas disponible pour cette commande.'); error.statusCode = 409; throw error; }
  if (order.shippingFeeFcfa === 0) return notificationSummary(order);
  if (!link || link.source !== 'SHIPPING' || link.countryId !== countryId || link.baseAmountFcfa !== order.shippingFeeFcfa) { const error = new Error('Le paiement ne correspond pas aux frais d’expédition de cette commande.'); error.statusCode = 409; throw error; }
  if (link.status === 'PAID' && link.providerStatus === 'SUCCEEDED') return { status: 'NOT_REQUIRED', message: 'Les frais d’expédition sont déjà réglés.', channels: [] };
  if (link.status !== 'ACTIVE' || (link.expiresAt && new Date(link.expiresAt) <= new Date())) { const error = new Error('Cette demande de paiement n’est plus active. Réenregistrez les frais pour créer un nouveau lien.'); error.statusCode = 409; throw error; }
  try {
    const url = paymentUrl(order);
    const format = value => Number(value || 0).toLocaleString('fr-FR') + ' FCFA';
    await sendPreorderNotification({
      preorder: order, purpose: 'SHIPPING_PAYMENT_LINK', actorName,
      message: `Expedition ${carrierLabel(order.deliveryMode)}: ${link.amountFcfa} FCFA. ${url}`,
      emailSubject: `FOREVER | Frais d’expédition - ${order.preorderNumber || order.id}`,
      emailMessage: [
        `Bonjour ${order.fboNomComplet || 'Client'},`, '',
        `Les frais d’expédition par ${carrierLabel(order.deliveryMode)} de votre précommande ${order.preorderNumber || order.id} sont disponibles.`, '',
        `Frais d’expédition : ${format(link.baseAmountFcfa)}`,
        `Frais de paiement Wave : ${format(link.serviceFeeFcfa)}`,
        `Total à régler séparément : ${format(link.amountFcfa)}`, '',
        'Vos produits sont déjà payés. Ce règlement concerne uniquement l’expédition.',
        'Réglez ces frais pour permettre la remise de votre colis au transporteur.', '',
        `Payer les frais d’expédition : ${url}`,
      ].join('\n'),
      paymentLinkTarget: url, paymentLinkTracked: url,
    });
    const messages = await prisma.orderMessage.findMany({ where: { preorderId: order.id, purpose: 'PAYMENT_LINK', paymentLinkTarget: url }, orderBy: { createdAt: 'desc' }, take: 20 });
    return notificationSummary({ ...order, messages });
  } catch (error) {
    console.error('[shipping] notification failed', { orderId, name: error?.name, code: error?.code });
    return { status: 'FAILED', message: 'Les frais sont enregistrés, mais la notification n’a pas pu être envoyée. Utilisez « Notifier le client » pour réessayer.', channels: [] };
  }
}

module.exports = { paymentUrl, notificationSummary, withShippingNotification, notifyShippingPayment };
