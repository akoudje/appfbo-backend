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

module.exports = {
  normalizeCI,
};
