const crypto = require('crypto');
const prisma = require('../prisma');
const {
  normalizeEmail,
  sendEmail
} = require('../services/email.service');
const {
  renderLayout,
  renderHighlightBox
} = require('../services/email-templates/layout');
const session = require('../services/ticket-portal-session.service');
const sms = require('./ticketSmsRecovery.controller');
const recovery = require('../services/ticket-phone-recovery.service');
const {
  signTicketOrderAccessToken
} = require('../services/ticket-order-ticketing.service');
const OTP_ERROR = 'Code invalide ou expiré. Demandez un nouveau code si nécessaire.';
function failure(res, error) {
  console.error('[ticket-portal] operation failed', {
    name: error.name,
    code: error.code
  });
  return res.status(503).json({
    message: 'Service indisponible pour le moment. Réessayez dans un instant.'
  });
}
async function requestOtp(req, res) {
  if (req.body?.channel === 'SMS') return sms.requestLogin(req, res);
  if (req.body?.channel && req.body.channel !== 'EMAIL') return res.status(400).json({
    message: 'Choisissez email ou SMS.'
  });
  const email = normalizeEmail(req.body?.email);
  if (!email || email.length > 254) return res.status(400).json({
    message: 'Saisissez une adresse email valide.'
  });
  try {
    const id = crypto.randomUUID(),
      code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await prisma.ticketPortalOtpChallenge.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }
      }
    });
    await prisma.$transaction(async tx => {
      await tx.ticketPortalOtpChallenge.updateMany({
        where: {
          countryId: req.countryId,
          email,
          consumedAt: null
        },
        data: {
          consumedAt: new Date()
        }
      });
      await tx.ticketPortalOtpChallenge.create({
        data: {
          id,
          countryId: req.countryId,
          email,
          codeHash: session.codeHash({
            id,
            email,
            countryId: req.countryId,
            code
          }),
          expiresAt
        }
      });
    });
    try {
      const result = await sendEmail({
        to: email,
        subject: 'Votre code pour Mes tickets',
        body: `Votre code de connexion : ${code}. Il expire dans 10 minutes. Ne le partagez avec personne.`,
        html: renderLayout({
          title: 'Accéder à mes tickets',
          bodyHtml: renderHighlightBox({
            label: 'Code de connexion',
            value: code
          }) + '<p>Ce code expire dans 10 minutes. Ne le partagez avec personne. Si vous n’avez pas demandé ce code, ignorez cet email.</p>'
        })
      });
      if (!result?.accepted) throw Object.assign(new Error('OTP_EMAIL_FAILED'), {
        code: result?.errorCode || 'EMAIL_FAILED'
      });
    } catch (error) {
      await prisma.ticketPortalOtpChallenge.updateMany({
        where: {
          id
        },
        data: {
          consumedAt: new Date()
        }
      });
      throw error;
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      challengeId: id,
      expiresInSeconds: 600,
      retryAfterSeconds: 60,
      message: 'Un code de connexion a été envoyé à cette adresse. Il permet de consulter uniquement les achats associés à cet email.'
    });
  } catch (error) {
    return failure(res, error);
  }
}
async function verifyOtp(req, res) {
  if (req.body?.channel === 'SMS') return sms.verifyLogin(req, res);
  const id = String(req.body?.challengeId || ''),
    email = normalizeEmail(req.body?.email),
    code = String(req.body?.code || '');
  if (!email || id.length > 80 || !/^[0-9a-f-]{36}$/i.test(id) || !/^\d{6}$/.test(code)) return res.status(400).json({
    message: OTP_ERROR
  });
  try {
    const valid = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "TicketPortalOtpChallenge" WHERE "id" = ${id} FOR UPDATE`;
      const challenge = await tx.ticketPortalOtpChallenge.findUnique({
        where: {
          id
        }
      });
      if (!challenge || challenge.channel && challenge.channel !== 'EMAIL' || challenge.purpose && challenge.purpose !== 'LOGIN' || challenge.countryId !== req.countryId || challenge.email !== email || challenge.consumedAt || challenge.attempts >= 5 || challenge.expiresAt <= new Date()) return false;
      if (!session.sameHash(challenge.codeHash, session.codeHash({
        id,
        email,
        countryId: req.countryId,
        code
      }))) {
        await tx.ticketPortalOtpChallenge.update({
          where: {
            id
          },
          data: {
            attempts: {
              increment: 1
            }
          }
        });
        return false;
      }
      await tx.ticketPortalOtpChallenge.update({
        where: {
          id
        },
        data: {
          consumedAt: new Date()
        }
      });
      return true;
    });
    if (!valid) return res.status(400).json({
      message: OTP_ERROR
    });
    res.cookie(session.COOKIE, session.signSession(email, req.countryId), session.cookieOptions());
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      ok: true,
      email
    });
  } catch (error) {
    return failure(res, error);
  }
}
async function getSession(req, res) {
  try {
    const portal = await sms.currentScope(req.ticketPortal, req);
    if (!portal) return res.status(401).json({
      message: 'Reconnectez-vous pour retrouver vos tickets.'
    });
    return res.json(sms.summary(portal));
  } catch (error) {
    return failure(res, error);
  }
}
function logout(_req, res) {
  const {
    maxAge: _maxAge,
    ...options
  } = session.cookieOptions();
  res.clearCookie(session.COOKIE, options);
  return res.json({
    ok: true
  });
}
async function listOrders(req, res) {
  try {
    const result = await prisma.$transaction(async tx => {
      const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page || '1', 10) || 1)),
        pageSize = 20;
      const portal = await sms.currentScope(req.ticketPortal, req, tx);
      if (!portal) return {
        status: 401,
        body: {
          message: 'Reconnectez-vous pour retrouver vos tickets.'
        }
      };
      if (portal.scope === 'PENDING_REFERENCE') return {
        status: 409,
        body: {
          code: 'ORDER_REFERENCE_REQUIRED',
          ...sms.summary(portal),
          message: 'Saisissez votre référence d’achat pour ouvrir vos tickets.'
        }
      };
      const where = portal.channel === 'SMS' ? {
        ...recovery.whereForPhone(portal.phone, req.countryId, req.country.code),
        ...(portal.orderId ? {
          id: portal.orderId
        } : {})
      } : {
        countryId: req.countryId,
        buyerEmail: {
          equals: portal.email,
          mode: 'insensitive'
        }
      };
      const [total, orders] = await Promise.all([tx.ticketOrder.count({
        where
      }), tx.ticketOrder.findMany({
        where,
        orderBy: [{
          createdAt: 'desc'
        }, {
          id: 'desc'
        }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          orderNumber: true,
          status: true,
          quantity: true,
          createdAt: true,
          paidAt: true,
          event: {
            select: {
              title: true,
              startsAt: true,
              venueName: true
            }
          },
          _count: {
            select: {
              tickets: true
            }
          }
        }
      })]);
      return {
        status: 200,
        body: {
          ...sms.summary(portal),
          data: orders.map(order => ({
            orderNumber: order.orderNumber,
            status: order.status,
            quantity: order.quantity,
            createdAt: order.createdAt,
            paidAt: order.paidAt,
            event: {
              title: order.event.title,
              startsAt: order.event.startsAt,
              venueName: order.event.venueName
            },
            ticketCount: order._count?.tickets || 0,
            accessToken: signTicketOrderAccessToken(order.orderNumber)
          })),
          page,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
          total
        }
      };
    }, {
      isolationLevel: 'RepeatableRead'
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return failure(res, error);
  }
}
module.exports = {
  requestOtp,
  verifyOtp,
  getSession,
  logout,
  listOrders
};
