function normalizeCI(number) {
  const raw = String(number || "").trim();
  if (!raw) return "";

  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("00225") && digits.length > 10) {
    digits = digits.slice(5);
  } else if (digits.startsWith("225") && digits.length > 10) {
    digits = digits.slice(3);
  }

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

  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("00226") && digits.length > 8) {
    digits = digits.slice(5);
  } else if (digits.startsWith("226") && digits.length > 8) {
    digits = digits.slice(3);
  }

  if (/^\d{8}$/.test(digits)) {
    return `+226${digits}`;
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
