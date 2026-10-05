// Protect operational order responses, including historical notification payloads.
// Client notifications are generated before this response boundary and stay intact.
const MESSAGE_FIELDS = new Set([
  "id", "preorderId", "channel", "purpose", "status", "createdAt", "updatedAt",
  "sentAt", "deliveredAt", "readAt", "failedAt",
]);
function sanitizePickupResponse(payload) {
  if (payload === undefined) return payload;
  // Match JSON serialization of Prisma decimals and dates without mutating DB objects.
  const serialized = JSON.parse(JSON.stringify(payload));
  function clean(value) {
    if (Array.isArray(value)) return value.map(clean);
    if (!value || typeof value !== "object") return value;
    const notification = value.channel && ["ORDER_READY", "REMINDER"].includes(value.purpose);
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== "pickupSecretCode" && key !== "pickupCode" && (!notification || MESSAGE_FIELDS.has(key)))
      .map(([key, nested]) => [key, clean(nested)]));
  }
  return clean(serialized);
}
function protectPickupSecrets(req, res, next) {
  const json = res.json;
  res.json = function (payload) { return json.call(this, sanitizePickupResponse(payload)); };
  next();
}
module.exports = { protectPickupSecrets, sanitizePickupResponse };
