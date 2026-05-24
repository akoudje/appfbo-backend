function normalizeCI(number) {
  const raw = String(number || "").trim();
  if (!raw) return "";

  if (raw.startsWith("+")) {
    const compact = raw.replace(/\s+/g, "");
    return /^\+\d+$/.test(compact) ? compact : "";
  }

  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  if (/^0\d{9}$/.test(digits)) {
    return `+225${digits}`;
  }

  if (/^\d{10}$/.test(digits)) {
    return `+225${digits}`;
  }

  return "";
}

function normalizeBFA(number) {
  const raw = String(number || "").trim();
  if (!raw) return "";

  if (raw.startsWith("+")) {
    const compact = raw.replace(/\s+/g, "");
    if (/^\+226\d{8}$/.test(compact)) return compact;
    return "";
  }

  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  if (/^\d{8}$/.test(digits)) {
    return `+226${digits}`;
  }

  if (/^226\d{8}$/.test(digits)) {
    return `+${digits}`;
  }

  return "";
}

function normalizeForCountry(number, countryCode = "CIV") {
  const normalizedCountry = String(countryCode || "CIV").trim().toUpperCase();
  if (normalizedCountry === "BFA") return normalizeBFA(number);
  return normalizeCI(number);
}

module.exports = {
  normalizeCI,
  normalizeBFA,
  normalizeForCountry,
};
