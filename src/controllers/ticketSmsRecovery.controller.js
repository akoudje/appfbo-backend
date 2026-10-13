const prisma = require('../prisma');
const recovery = require('../services/ticket-phone-recovery.service');
const otp = require('../services/ticket-sms-otp.service');
const session = require('../services/ticket-portal-session.service');
const {
  verifyTicketOrderAccessToken
} = require('../services/ticket-order-ticketing.service');
const OTP_ERROR = 'Code invalide ou expiré. Demandez un nouveau code si nécessaire.';
function failure(res, error) {
  console.error('[ticket-sms] operation failed', {
    name: error.name,
    code: error.code
  });
  return res.status(503).json({
    message: 'Le service SMS est indisponible. Réessayez ou utilisez votre email d’achat.'
  });
}
function capabilities(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    email: true,
    sms: recovery.available(req.country?.code)
  });
}
function summary(portal) {
  return portal.channel === 'SMS' ? {
    channel: 'SMS',
    maskedPhone: recovery.mask(portal.phone),
    requiresOrderReference: portal.scope === 'PENDING_REFERENCE',
    singleOrder: portal.scope === 'ORDER'
  } : {
    channel: 'EMAIL',
    email: portal.email
  };
}
async function currentScope(portal, req, db = prisma) {
  if (portal.channel !== 'SMS') return portal;
  if (portal.scope === 'PENDING_REFERENCE') return portal;
  const scope = await recovery.scopeForPhone(db, portal.phone, req.countryId, req.country?.code, portal.orderId);
  return scope ? {
    ...portal,
    ...scope
  } : null;
}
async function requestLogin(req, res) {
  if (!recovery.available(req.country?.code)) return res.status(503).json({
    message: 'L’accès par SMS n’est pas disponible dans ce pays. Utilisez votre email d’achat.'
  });
  const phone = recovery.phone(req.body?.phone, req.country?.code);
  const reference = String(req.body?.orderNumber || '').trim().toUpperCase();
  if (!phone || reference.length > 80) return res.status(400).json({
    message: 'Saisissez un numéro de téléphone valide pour le pays de votre achat.'
  });
  try {
    const matched = await prisma.ticketOrder.findFirst({
      where: {
        ...recovery.whereForPhone(phone, req.countryId, req.country.code),
        ...(reference ? {
          orderNumber: reference
        } : {})
      },
      select: {
        id: true
      }
    });
    const challenge = await otp.create(prisma, {
      countryId: req.countryId,
      phone,
      purpose: 'LOGIN',
      orderId: reference && matched ? matched.id : null,
      deliver: Boolean(matched)
    });
    // Respond identically for unknown contacts/references and do not expose provider timing.
    if (matched) setImmediate(() => otp.deliver(prisma, challenge, req.country.code).catch(error => {
      console.error('[ticket-sms] delivery failed', {
        name: error.name,
        code: error.code
      });
    }));
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      challengeId: challenge.id,
      expiresInSeconds: 600,
      retryAfterSeconds: 60,
      message: 'Si un achat correspond à ces informations, un code sera envoyé au numéro enregistré lors de l’achat.'
    });
  } catch (error) {
    return failure(res, error);
  }
}
async function verifyLogin(req, res) {
  const phone = recovery.phone(req.body?.phone, req.country?.code);
  if (!phone) return res.status(400).json({
    message: OTP_ERROR
  });
  try {
    const result = await prisma.$transaction(async tx => {
      const challenge = await otp.consume(tx, {
        id: req.body?.challengeId,
        phone,
        countryId: req.countryId,
        purpose: 'LOGIN',
        code: req.body?.code
      });
      if (!challenge) return null;
      return recovery.scopeForPhone(tx, phone, req.countryId, req.country.code, challenge.orderId);
    });
    if (!result) return res.status(400).json({
      message: OTP_ERROR
    });
    const portal = {
      channel: 'SMS',
      phone,
      ...result
    };
    res.cookie(session.COOKIE, session.signPhoneSession(phone, req.countryId, result.scope, result.orderId), {
      ...session.cookieOptions(),
      ...(result.scope === 'PENDING_REFERENCE' ? {
        maxAge: 15 * 60 * 1000
      } : {})
    });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      ok: true,
      ...summary(portal)
    });
  } catch (error) {
    return failure(res, error);
  }
}
async function selectReference(req, res) {
  const portal = req.ticketPortal;
  if (portal.channel !== 'SMS') return res.status(400).json({
    message: 'Cette vérification concerne l’accès par SMS.'
  });
  const orderNumber = String(req.body?.orderNumber || '').trim().toUpperCase();
  if (!orderNumber || orderNumber.length > 80) return res.status(400).json({
    message: 'Saisissez la référence de votre achat.'
  });
  try {
    const order = await prisma.ticketOrder.findFirst({
      where: {
        ...recovery.whereForPhone(portal.phone, req.countryId, req.country.code),
        orderNumber
      },
      select: {
        id: true
      }
    });
    if (!order) return res.status(400).json({
      message: 'Cette référence ne correspond pas au téléphone vérifié. Vérifiez votre justificatif d’achat.'
    });
    res.cookie(session.COOKIE, session.signPhoneSession(portal.phone, req.countryId, 'ORDER', order.id), session.cookieOptions());
    return res.json({
      ok: true,
      ...summary({
        ...portal,
        scope: 'ORDER'
      })
    });
  } catch (error) {
    return failure(res, error);
  }
}
async function ownedPhone(req, res, next) {
  try {
    const orderNumber = String(req.params.orderNumber || '').trim().toUpperCase();
    if (!verifyTicketOrderAccessToken(orderNumber, req.query.token)) return res.status(404).json({
      message: 'Ce lien d’achat est indisponible.'
    });
    const order = await prisma.ticketOrder.findFirst({
      where: {
        countryId: req.countryId,
        orderNumber
      }
    });
    if (!order) return res.status(404).json({
      message: 'Achat introuvable.'
    });
    if (order.status !== 'PAID' || order.paymentStatus === 'REFUNDED') return res.status(409).json({
      message: 'La vérification du téléphone est disponible après paiement.'
    });
    const phone = recovery.phone(order.buyerPhone, req.country?.code);
    if (!phone || !recovery.available(req.country?.code)) return res.status(503).json({
      message: 'La vérification par SMS est indisponible pour ce numéro.'
    });
    req.ticketPhoneOrder = order;
    req.ticketPhone = phone;
    res.setHeader('Cache-Control', 'private, no-store');
    return next();
  } catch (error) {
    return failure(res, error);
  }
}
async function requestBinding(req, res) {
  try {
    const challenge = await otp.create(prisma, {
      countryId: req.countryId,
      phone: req.ticketPhone,
      purpose: 'PHONE_BIND',
      orderId: req.ticketPhoneOrder.id
    });
    await otp.deliver(prisma, challenge, req.country.code);
    return res.json({
      challengeId: challenge.id,
      maskedPhone: recovery.mask(req.ticketPhone),
      expiresInSeconds: 600,
      retryAfterSeconds: 60
    });
  } catch (error) {
    return failure(res, error);
  }
}
async function verifyBinding(req, res) {
  try {
    const valid = await prisma.$transaction(async tx => {
      const challenge = await otp.consume(tx, {
        id: req.body?.challengeId,
        phone: req.ticketPhone,
        countryId: req.countryId,
        purpose: 'PHONE_BIND',
        orderId: req.ticketPhoneOrder.id,
        code: req.body?.code
      });
      if (!challenge) return false;
      await tx.$queryRaw`SELECT "id" FROM "TicketOrder" WHERE "id" = ${challenge.orderId} FOR NO KEY UPDATE`;
      const current = await tx.ticketOrder.findFirst({
        where: {
          id: challenge.orderId,
          countryId: req.countryId
        }
      });
      if (!current || current.status !== 'PAID' || current.paymentStatus === 'REFUNDED' || recovery.phone(current.buyerPhone, req.country.code) !== challenge.phone) return false;
      await tx.ticketOrder.update({
        where: {
          id: current.id
        },
        data: {
          buyerPhoneVerified: challenge.phone,
          buyerPhoneVerifiedAt: new Date()
        }
      });
      return true;
    });
    if (!valid) return res.status(400).json({
      message: OTP_ERROR
    });
    return res.json({
      ok: true,
      buyerPhoneVerified: true,
      maskedPhone: recovery.mask(req.ticketPhone)
    });
  } catch (error) {
    return failure(res, error);
  }
}
function rateKey(req) {
  return `${req.countryId}:SMS:${req.ticketPhone || recovery.phone(req.body?.phone, req.country?.code) || 'invalid'}`;
}
module.exports = {
  capabilities,
  summary,
  currentScope,
  requestLogin,
  verifyLogin,
  selectReference,
  ownedPhone,
  requestBinding,
  verifyBinding,
  rateKey
};
