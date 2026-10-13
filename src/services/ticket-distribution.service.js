const crypto = require('crypto');
const {
  fail
} = require('./ticket-inventory.service');
function secrets() {
  return [process.env.CUSTOMER_JWT_SECRET, process.env.JWT_SECRET].map(value => String(value || '').trim()).filter(Boolean);
}
function guestToken(ticket, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(['ticket-guest-v1', ticket.id, ticket.orderId, ticket.qrToken])).digest('base64url');
}
function signGuestToken(ticket) {
  const [secret] = secrets();
  if (!secret) throw new Error('TICKET_SHARE_SECRET_MISSING');
  return guestToken(ticket, secret);
}
function verifyGuestToken(ticket, token) {
  const actual = Buffer.from(String(token || ''));
  return secrets().some(secret => {
    const expected = Buffer.from(guestToken(ticket, secret));
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  });
}
function distribution(ticket) {
  const history = ticket.shareEvents || [];
  return {
    assignedGuestName: ticket.assignedGuestName || null,
    guestAssignedAt: ticket.guestAssignedAt || null,
    shareCount: ticket._count?.shareEvents ?? history.length,
    lastShareId: history[0]?.id || null,
    shareHistory: history.map(event => ({
      id: event.id,
      channel: event.channel,
      guestName: event.guestName,
      createdAt: event.createdAt
    }))
  };
}
function guestName(value) {
  if (typeof value !== 'string' || value.length > 120 || /[\x00-\x1f\x7f]/.test(value)) fail('Le nom de l’invité doit contenir au plus 120 caractères.');
  return value.trim();
}
function assertMutable(order, ticket) {
  if (!order || order.status !== 'PAID' || order.paymentStatus === 'REFUNDED' || order.ticketIssueCode || !ticket || ticket.status !== 'ACTIVE') fail('Ce billet ne peut plus être attribué ou partagé. Actualisez votre achat.', 409);
}
function shareInput(body) {
  if (!['WHATSAPP', 'EMAIL', 'NATIVE', 'MANUAL'].includes(body.channel)) fail('Choisissez le canal du partage.');
  if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId)) fail('Identifiant de partage invalide.');
  if (!Array.isArray(body.tickets) || !body.tickets.length || body.tickets.length > 50 || new Set(body.tickets.map(t => t?.ticketId)).size !== body.tickets.length) fail('Choisissez les billets à partager.');
  for (const ticket of body.tickets) {
    if (typeof ticket?.ticketId !== 'string' || ticket.ticketId.length > 100 || !Object.hasOwn(ticket, 'expectedLastShareId') || ticket.expectedLastShareId !== null && (typeof ticket.expectedLastShareId !== 'string' || ticket.expectedLastShareId.length > 100)) fail('Sélection de billets invalide.');
  }
  return body;
}
module.exports = {
  signGuestToken,
  verifyGuestToken,
  distribution,
  guestName,
  assertMutable,
  shareInput
};
