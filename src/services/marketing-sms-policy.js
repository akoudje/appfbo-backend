const COMPLETED_STATUSES = new Set(["SENT", "SKIPPED", "CONFIRMED", "DECLINED", "INVALID"]);
function isEligibleRecipient(recipient, failedOnly = false) {
  if (!recipient.phoneNormalized) return false;
  const status = String(recipient.status || "").toUpperCase();
  return failedOnly ? status === "FAILED" : !COMPLETED_STATUSES.has(status);
}
module.exports = { isEligibleRecipient };
