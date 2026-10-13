const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const {
  normalizeEmail
} = require('./email.service');
const COOKIE = 'tpt';
function secret() {
  const value = process.env.CUSTOMER_JWT_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error('TICKET_PORTAL_SECRET_MISSING');
  return value;
}
function codeHash({
  id,
  email,
  countryId,
  code
}) {
  return crypto.createHmac('sha256', secret()).update(JSON.stringify(['ticket-portal-otp', id, email, countryId, code])).digest('hex');
}
function sameHash(left, right) {
  const a = Buffer.from(left || '', 'hex'),
    b = Buffer.from(right || '', 'hex');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/ticketing',
    maxAge: 12 * 60 * 60 * 1000
  };
}
function signSession(email, countryId) {
  return jwt.sign({
    type: 'ticket_portal',
    email,
    countryId
  }, secret(), {
    expiresIn: '12h',
    audience: 'ticket-portal'
  });
}
function readSession(req) {
  try {
    const match = String(req.headers?.cookie || '').match(/(?:^|;\s*)tpt=([^;]*)/);
    if (!match) return null;
    const payload = jwt.verify(decodeURIComponent(match[1]), secret(), {
      audience: 'ticket-portal',
      algorithms: ['HS256']
    });
    const email = normalizeEmail(payload.email);
    return payload.type === 'ticket_portal' && email && payload.countryId === req.countryId ? {
      email,
      countryId: payload.countryId
    } : null;
  } catch {
    return null;
  }
}
function requireSession(req, res, next) {
  const session = readSession(req);
  if (!session) return res.status(401).json({
    message: 'Connectez-vous par email pour retrouver vos tickets.'
  });
  req.ticketPortal = session;
  res.setHeader('Cache-Control', 'private, no-store');
  return next();
}
function requireJson(req, res, next) {
  if (!req.is('application/json')) return res.status(415).json({
    message: 'Format de requête non accepté.'
  });
  return next();
}
module.exports = {
  COOKIE,
  codeHash,
  sameHash,
  cookieOptions,
  signSession,
  readSession,
  requireSession,
  requireJson
};
