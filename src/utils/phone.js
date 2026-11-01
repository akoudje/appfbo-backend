const { parsePhoneNumberFromString } = require("libphonenumber-js/max");

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

// Pays de l'application (code ISO alpha-3) -> région libphonenumber (alpha-2).
const COUNTRY_REGION = {
  CIV: "CI",
  BFA: "BF",
  TGO: "TG",
  BEN: "BJ",
  NER: "NE",
};

function regionForCountry(countryCode = "CIV") {
  return COUNTRY_REGION[String(countryCode || "CIV").trim().toUpperCase()] || "CI";
}

function parseValid(number, region) {
  const raw = String(number || "").trim();
  if (!raw || raw.length > 40 || !/^\+?[\d\s().-]+$/.test(raw)) return null;
  const parsed = parsePhoneNumberFromString(raw, region);
  return parsed && parsed.isValid() ? parsed : null;
}

/**
 * Numéro NATIONAL du pays (format E.164), ou "" s'il n'appartient pas au pays.
 * C'est le seul format joignable par SMS (opérateur local).
 */
function normalizeForCountry(number, countryCode = "CIV") {
  const normalizedCountry = String(countryCode || "CIV").trim().toUpperCase();
  if (normalizedCountry === "BFA") return normalizeBFA(number);
  if (normalizedCountry === "CIV" || !COUNTRY_REGION[normalizedCountry]) return normalizeCI(number);
  const region = regionForCountry(normalizedCountry);
  const parsed = parseValid(number, region);
  return parsed && parsed.country === region ? parsed.number : "";
}

/**
 * Numéro de contact de n'importe quel pays (format E.164), ou "" s'il est invalide.
 * Sans indicatif (+ ou 00), le numéro est lu comme un numéro du pays de la commande.
 */
function normalizeInternationalPhone(number, countryCode = "CIV") {
  const national = normalizeForCountry(number, countryCode);
  if (national) return national;
  const raw = String(number || "").trim();
  const international = raw.startsWith("+") || raw.replace(/\D/g, "").startsWith("00");
  const parsed = parseValid(international ? raw : `+${raw.replace(/\D/g, "")}`, regionForCountry(countryCode));
  return parsed ? parsed.number : "";
}

/** Vrai si le numéro (E.164) est un numéro du pays, donc joignable par SMS. */
function isNationalPhone(e164, countryCode = "CIV") {
  return Boolean(e164) && normalizeForCountry(e164, countryCode) === e164;
}

/** Région alpha-2 d'un numéro E.164 (ex. "FR"), ou "". */
function phoneRegion(e164) {
  const parsed = parseValid(e164);
  return parsed?.country || "";
}

/**
 * Téléphone + WhatsApp saisis par un client.
 * - le téléphone est obligatoire, de n'importe quel pays ;
 * - un numéro étranger n'est joignable que sur WhatsApp : il devient aussi le WhatsApp ;
 * - sinon le WhatsApp est le même numéro (case cochée), un autre numéro, ou absent.
 */
function resolveContactPhones({ phone, whatsapp, whatsappSameAsPhone } = {}, countryCode = "CIV") {
  const normalizedPhone = normalizeInternationalPhone(phone, countryCode);
  if (!normalizedPhone) {
    return {
      ok: false,
      code: String(phone || "").trim() ? "PHONE_INVALID" : "PHONE_REQUIRED",
      error: String(phone || "").trim()
        ? "Le numéro de téléphone est invalide. Vérifiez l'indicatif du pays."
        : "Le numéro de téléphone est obligatoire.",
    };
  }
  const national = isNationalPhone(normalizedPhone, countryCode);
  if (!national || whatsappSameAsPhone === true || whatsappSameAsPhone === "true") {
    return { ok: true, phone: normalizedPhone, whatsapp: normalizedPhone, national };
  }
  if (!String(whatsapp || "").trim()) {
    return { ok: true, phone: normalizedPhone, whatsapp: null, national };
  }
  const normalizedWhatsapp = normalizeInternationalPhone(whatsapp, countryCode);
  if (!normalizedWhatsapp) {
    return {
      ok: false,
      code: "WHATSAPP_INVALID",
      error: "Le numéro WhatsApp est invalide. Vérifiez l'indicatif du pays.",
    };
  }
  return { ok: true, phone: normalizedPhone, whatsapp: normalizedWhatsapp, national };
}

module.exports = {
  resolveContactPhones,
  normalizeCI,
  normalizeBFA,
  normalizeForCountry,
  normalizeInternationalPhone,
  isNationalPhone,
  phoneRegion,
  regionForCountry,
};
