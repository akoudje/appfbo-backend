const {
  orangeConfigured
} = require('./sms.service');
const COUNTRIES = {
  CIV: {
    prefix: '225',
    digits: 10
  },
  BFA: {
    prefix: '226',
    digits: 8
  }
};
function phone(value, countryCode) {
  const config = COUNTRIES[countryCode];
  if (!config || typeof value !== 'string' || value.length > 40 || !/^\+?[\d\s().-]+$/.test(value.trim())) return '';
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00' + config.prefix)) digits = digits.slice(2 + config.prefix.length);else if (digits.length === config.digits + config.prefix.length && digits.startsWith(config.prefix)) digits = digits.slice(config.prefix.length);
  if (digits.length !== config.digits || value.trim().startsWith('+') && !value.replace(/\D/g, '').startsWith(config.prefix)) return '';
  return '+' + config.prefix + digits;
}
function variants(canonical, countryCode) {
  const config = COUNTRIES[countryCode];
  if (!config || phone(canonical, countryCode) !== canonical) return [];
  return [canonical, canonical.slice(1), '00' + canonical.slice(1), canonical.slice(1 + config.prefix.length)];
}
function available(countryCode) {
  return Boolean(COUNTRIES[countryCode] && orangeConfigured(countryCode));
}
function mask(canonical) {
  return canonical ? canonical.slice(0, 4) + ' •••• ' + canonical.slice(-4) : '';
}
function whereForPhone(canonical, countryId, countryCode) {
  return {
    countryId,
    buyerPhone: {
      in: variants(canonical, countryCode)
    }
  };
}
async function scopeForPhone(db, canonical, countryId, countryCode, orderId) {
  const where = whereForPhone(canonical, countryId, countryCode);
  const orders = await db.ticketOrder.findMany({
    where: {
      ...where,
      ...(orderId ? {
        id: orderId
      } : {})
    },
    select: {
      id: true,
      buyerEmail: true,
      buyerFullName: true
    }
  });
  if (!orders.length) return null;
  if (orderId) return {
    scope: 'ORDER',
    orderId
  };
  // Missing email identities cannot safely be merged across separate purchases.
  const identities = new Set(orders.map(order => {
    const email = String(order.buyerEmail || '').trim().toLowerCase();
    const name = String(order.buyerFullName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
    return email && name ? JSON.stringify([email, name]) : order.id;
  }));
  return {
    scope: identities.size > 1 ? 'PENDING_REFERENCE' : 'PHONE'
  };
}
function isVerified(order, countryCode) {
  const canonical = phone(order.buyerPhone, countryCode);
  return Boolean(canonical && order.buyerPhoneVerifiedAt && order.buyerPhoneVerified === canonical);
}
module.exports = {
  phone,
  variants,
  available,
  mask,
  whereForPhone,
  scopeForPhone,
  isVerified
};
