const crypto = require("crypto");

function ticketCode() {
  const stamp = new Date().toISOString().slice(2, 10).replace(/\D/g, "");
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `TCK-${stamp}-${suffix}`;
}

function ticketQrToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function ticketOrderNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/\D/g, "");
  // 5 octets (40 bits, ~1 100 milliards de combinaisons/jour) : ce numéro
  // sert de clé de consultation publique et non authentifiée sur
  // GET /orders/:orderNumber (ticketing.routes.js), qui renvoie le qrToken
  // des billets. Un suffixe court le rendrait devinable/énumérable — voir
  // aussi le rate-limiter posé sur cette route.
  const suffix = crypto.randomBytes(5).toString("hex").toUpperCase();
  return `EVT-${stamp}-${suffix}`;
}

// Preuve de possession pour la consultation publique d'une commande de
// ticket (GET /ticketing/orders/:orderNumber et endpoints Wave associés).
// Le orderNumber (voir ci-dessus) est désormais peu devinable, mais reste un
// identifiant *connaissable* : quiconque l'obtient (lien intercepté, log,
// erreur d'envoi) peut consulter la commande, dont le qrToken — le vrai
// credential de contrôle d'accès physique. Ce token HMAC, ajouté à tous les
// liens générés côté serveur (redirection après achat, retour Wave, email
// de tickets), prouve que l'appelant a bien reçu le lien légitime : il ne
// peut pas être recalculé sans connaître le secret serveur, même en
// connaissant le orderNumber. Stateless (rien à stocker en base) et signé
// avec les mêmes secrets que les liens de paiement courts (rotation
// supportée via plusieurs candidats).
function getTicketOrderAccessSecretCandidates() {
  const seen = new Set();
  const candidates = [];
  for (const value of [process.env.CUSTOMER_JWT_SECRET, process.env.JWT_SECRET]) {
    const trimmed = String(value || "").trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      candidates.push(trimmed);
    }
  }
  return candidates;
}

function computeTicketOrderAccessToken(orderNumber, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(String(orderNumber || "").trim().toUpperCase())
    .digest("base64url");
}

function signTicketOrderAccessToken(orderNumber) {
  const [secret] = getTicketOrderAccessSecretCandidates();
  // validate-env.js impose CUSTOMER_JWT_SECRET/JWT_SECRET au démarrage : ce
  // cas ne devrait jamais se produire en production, mais on ne signe
  // jamais avec une clé vide (un token vide échouerait de toute façon la
  // vérification, ce qui est le comportement sûr).
  if (!secret) return "";
  return computeTicketOrderAccessToken(orderNumber, secret);
}

function verifyTicketOrderAccessToken(orderNumber, token) {
  const provided = String(token || "").trim();
  if (!provided) return false;
  for (const secret of getTicketOrderAccessSecretCandidates()) {
    const expected = computeTicketOrderAccessToken(orderNumber, secret);
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    if (expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf)) {
      return true;
    }
  }
  return false;
}

function paidOrderTicketInclude() {
  return {
    country: { select: { code: true } },
    event: true,
    ticketType: true,
    tickets: { include: { ticketType: true } },
  };
}

async function ensureTicketsActivatedForPaidOrder(tx, order) {
  // Verrou de ligne PostgreSQL : le webhook Wave et un sync manuel (bouton
  // admin, retour client sur la page de paiement) peuvent invoquer cette
  // fonction quasi simultanément pour la même commande, chacun avec son
  // propre snapshot `order.tickets` chargé avant l'ouverture de sa
  // transaction. Sans ce verrou, les deux peuvent constater "aucun billet"
  // et en générer chacun un jeu complet. Le FOR UPDATE sérialise les appels
  // concurrents sur cette ligne : le second attend que le premier committe,
  // puis relit un compte de billets à jour avant de décider quoi que ce
  // soit.
  await tx.$queryRaw`SELECT id FROM "TicketOrder" WHERE id = ${order.id} FOR UPDATE`;

  const existingTicketsCount = await tx.ticket.count({ where: { orderId: order.id } });
  if (existingTicketsCount > 0) {
    await tx.ticket.updateMany({
      where: { orderId: order.id, status: "RESERVED" },
      data: { status: "ACTIVE" },
    });
    return;
  }

  const ticketTypeId = order.ticketTypeId || order.ticketType?.id || null;
  if (!ticketTypeId) {
    throw new Error("Type de ticket introuvable pour générer les billets.");
  }

  const quantity = Math.max(1, Math.min(50, Number.parseInt(order.quantity, 10) || 1));
  const holderFullName = order.holderFullName || order.buyerFullName;
  const holderPhone = order.holderPhone || order.buyerPhone || null;
  const holderEmail = order.holderEmail || order.buyerEmail || null;

  for (let i = 0; i < quantity; i += 1) {
    await tx.ticket.create({
      data: {
        countryId: order.countryId,
        eventId: order.eventId,
        ticketTypeId,
        orderId: order.id,
        ticketCode: ticketCode(),
        qrToken: ticketQrToken(),
        holderFullName,
        holderPhone,
        holderEmail,
        status: "ACTIVE",
      },
    });
  }
}

module.exports = {
  ticketOrderNumber,
  signTicketOrderAccessToken,
  verifyTicketOrderAccessToken,
  ensureTicketsActivatedForPaidOrder,
  paidOrderTicketInclude,
};
