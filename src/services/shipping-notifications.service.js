const prisma = require('../prisma');
const { isShipping, carrierLabel } = require('./shipping.service');
const { sendPreorderNotification, resolveNotificationEmail, resolveNotificationPhone } = require('./preorder-notifications.service');

function failureDescription(code) {
  if (['SMTP_FROM_NOT_CONFIGURED', 'EMAIL_PROVIDER_NOT_CONFIGURED', 'SMTP_TRANSPORT_UNAVAILABLE', 'MAILERSEND_API_KEY_MISSING', 'MAILERSEND_FROM_NOT_CONFIGURED'].includes(code)) return 'Le service email n’est pas configuré. Contactez l’administrateur.';
  if (['EAUTH', 'SMTP_AUTH_COOLDOWN', 'MAILERSEND_401', 'MAILERSEND_403'].includes(code)) return 'Le service email refuse l’authentification. Contactez l’administrateur.';
  if (code === 'SHIPPING_QUOTE_REPLACED') return 'Cette demande de paiement a été remplacée.';
  return 'L’envoi a échoué. Réessayez ou contactez l’administrateur.';
}

function paymentUrl(order) {
  const candidates = [process.env.FRONTEND_PUBLIC_URL, process.env.PUBLIC_APP_URL, process.env.APP_PUBLIC_BASE_URL, process.env.FRONTEND_URL, 'https://forevercivstore.com'];
  let base;
  for (const candidate of candidates) {
    const raw = String(candidate || '').trim();
    if (!raw) continue;
    try {
      // The existing external-payment service also accepts a host without a scheme.
      const value = /^([a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s]*)?$/i.test(raw) ? `https://${raw}` : raw;
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || /[\s,;]/.test(parsed.hostname) || parsed.hostname.toLowerCase().startsWith('admin.')) continue;
      parsed.search = '';
      parsed.hash = '';
      base = parsed;
      break;
    } catch { /* Try the next configured public address. */ }
  }
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
    const available = channel === 'EMAIL' ? Boolean(resolveNotificationEmail(order)) : Boolean(resolveNotificationPhone(order));
    const status = latest?.status || (available ? 'NOT_SENT' : 'UNAVAILABLE');
    return { channel, status, sentAt: latest?.sentAt || null, createdAt: latest?.createdAt || null,
      ...(status === 'FAILED' ? { detail: failureDescription(latest?.errorCode) } : {}) };
  });
  if (channels.every(item => item.status === 'UNAVAILABLE')) return { status: 'FAILED', code: 'NO_DESTINATION', message: 'Aucun email valide ni téléphone de notification n’est enregistré pour l’acheteur. Complétez les coordonnées de la commande avant de notifier le client. Le téléphone du destinataire du colis n’est pas utilisé pour demander le paiement.', channels };
  const accepted = channels.some(item => ['SENT', 'DELIVERED', 'READ', 'QUEUED'].includes(item.status));
  const failed = channels.some(item => item.status === 'FAILED');
  const queued = channels.some(item => item.status === 'QUEUED');
  const status = failed && accepted ? 'PARTIAL' : queued ? 'QUEUED' : accepted ? 'SENT' : failed ? 'FAILED' : 'NONE';
  const descriptions = { SENT: 'envoyé', DELIVERED: 'livré', READ: 'lu', QUEUED: 'en file d’envoi', FAILED: 'envoi échoué', NOT_SENT: 'non envoyé', UNAVAILABLE: 'coordonnée manquante' };
  const message = status === 'NONE' ? 'Aucune notification de paiement enregistrée. Utilisez « Notifier le client ».' : channels.map(item => `${item.channel === 'EMAIL' ? 'Email' : 'SMS'} : ${descriptions[item.status] || 'en attente'}${item.detail ? `. ${item.detail}` : ''}`).join(' · ');
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
    const result = await sendPreorderNotification({
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
    const summary = notificationSummary({ ...order, messages });
    if (summary.status === 'NONE' && !result?.sent && !result?.queued) return { ...summary, status: 'FAILED', message: 'Les frais sont enregistrés, mais aucun envoi email ou SMS n’a été accepté. Réessayez ou contactez l’administrateur.' };
    return summary;
  } catch (error) {
    console.error('[shipping] notification failed', { orderId, name: error?.name, code: error?.code });
    return { status: 'FAILED', message: 'Les frais sont enregistrés, mais la notification n’a pas pu être envoyée. Utilisez « Notifier le client » pour réessayer.', channels: [] };
  }
}

module.exports = { paymentUrl, notificationSummary, withShippingNotification, notifyShippingPayment };
