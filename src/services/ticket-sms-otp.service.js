const crypto = require('crypto');
const session = require('./ticket-portal-session.service');
const {
  sendSms
} = require('./sms.service');
async function create(db, {
  countryId,
  phone,
  purpose,
  orderId = null,
  deliver = true
}) {
  const id = crypto.randomUUID(),
    code = String(crypto.randomInt(100000, 1000000));
  const fields = {
    id,
    countryId,
    phone,
    channel: 'SMS',
    purpose,
    orderId
  };
  await db.ticketPortalOtpChallenge.deleteMany({
    where: {
      expiresAt: {
        lt: new Date(Date.now() - 86400000)
      }
    }
  });
  await db.$transaction(async tx => {
    await tx.ticketPortalOtpChallenge.updateMany({
      where: {
        countryId,
        phone,
        channel: 'SMS',
        purpose,
        consumedAt: null
      },
      data: {
        consumedAt: new Date()
      }
    });
    await tx.ticketPortalOtpChallenge.create({
      data: {
        ...fields,
        codeHash: session.codeHash({
          ...fields,
          code
        }),
        expiresAt: new Date(Date.now() + 600000),
        ...(!deliver ? {
          consumedAt: new Date()
        } : {})
      }
    });
  });
  return {
    ...fields,
    code
  };
}
async function deliver(db, challenge, countryCode) {
  try {
    const current = await db.ticketPortalOtpChallenge.findUnique({
      where: {
        id: challenge.id
      }
    });
    if (!current || current.consumedAt || current.expiresAt <= new Date()) return;
    const result = await sendSms({
      to: challenge.phone,
      countryCode,
      sensitive: true,
      message: `FOREVER - Mes tickets : code ${challenge.code}. Valable 10 min. Ne le partagez avec personne.`
    });
    if (!result?.accepted) throw Object.assign(new Error('SMS_OTP_FAILED'), {
      code: result?.errorCode || 'SMS_FAILED'
    });
  } catch (error) {
    await db.ticketPortalOtpChallenge.updateMany({
      where: {
        id: challenge.id
      },
      data: {
        consumedAt: new Date()
      }
    });
    throw error;
  }
}
// Consume under a row lock; a wrong code commits its attempt instead of rolling it back.
async function consume(tx, input) {
  const {
    id,
    phone,
    countryId,
    purpose,
    code
  } = input;
  if (!/^[0-9a-f-]{36}$/i.test(id || '') || !/^\d{6}$/.test(code || '')) return null;
  await tx.$queryRaw`SELECT "id" FROM "TicketPortalOtpChallenge" WHERE "id" = ${id} FOR UPDATE`;
  const challenge = await tx.ticketPortalOtpChallenge.findUnique({
    where: {
      id
    }
  });
  if (!challenge || challenge.channel !== 'SMS' || challenge.purpose !== purpose || challenge.phone !== phone || challenge.countryId !== countryId || challenge.consumedAt || challenge.attempts >= 5 || challenge.expiresAt <= new Date()) return null;
  if (input.orderId && challenge.orderId !== input.orderId) return null;
  if (!session.sameHash(challenge.codeHash, session.codeHash({
    ...challenge,
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
    return null;
  }
  await tx.ticketPortalOtpChallenge.update({
    where: {
      id
    },
    data: {
      consumedAt: new Date()
    }
  });
  return challenge;
}
module.exports = {
  create,
  deliver,
  consume
};
