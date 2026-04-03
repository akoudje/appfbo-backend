// src/middlewares/resolveCountry.js

const prisma = require("../prisma");

const COUNTRY_CACHE_TTL_MS = 5 * 60 * 1000;
const countryCache = new Map();

function normalizeCountryCode(raw) {
  return String(raw || "").trim().toUpperCase();
}

function getCachedCountry(code) {
  const cached = countryCache.get(code);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    countryCache.delete(code);
    return null;
  }
  cached.expiresAt = Date.now() + COUNTRY_CACHE_TTL_MS;
  return cached.country;
}

function setCachedCountry(code, country) {
  countryCache.set(code, {
    country,
    expiresAt: Date.now() + COUNTRY_CACHE_TTL_MS,
  });
}

function clearCountryCache(code) {
  if (code) {
    countryCache.delete(normalizeCountryCode(code));
    return;
  }
  countryCache.clear();
}

async function findCountryByCode(code) {
  const cached = getCachedCountry(code);
  if (cached) return cached;

  const country = await prisma.country.findUnique({
    where: { code },
    select: { id: true, code: true, name: true, actif: true },
  });

  if (country) setCachedCountry(code, country);
  return country;
}

function attachCountry(req, country) {
  req.country = {
    id: country.id,
    code: country.code,
    name: country.name,
  };
  req.countryId = country.id;
}

async function resolveCountry(req, res, next) {
  try {
    const countryCode = normalizeCountryCode(
      req.header("X-Country") ||
        req.query?.country ||
        req.query?.countryCode,
    );
    if (!countryCode) return res.status(400).json({ message: "Country required" });

    const country = await findCountryByCode(countryCode);
    if (!country) {
      return res.status(404).json({ message: `Country not found: ${countryCode}` });
    }
    if (!country.actif) {
      return res.status(403).json({ message: `Country inactive: ${countryCode}` });
    }

    attachCountry(req, country);
    return next();
  } catch (error) {
    console.error("resolveCountry error:", error);
    return res.status(500).json({ message: "Server error (resolveCountry)" });
  }
}

async function optionalCountry(req, res, next) {
  try {
    const countryCode = normalizeCountryCode(req.header("X-Country"));
    if (!countryCode) return next();

    const country = await findCountryByCode(countryCode);
    if (!country) {
      return res.status(404).json({ message: `Country not found: ${countryCode}` });
    }
    if (!country.actif) {
      return res.status(403).json({ message: `Country inactive: ${countryCode}` });
    }

    attachCountry(req, country);
    return next();
  } catch (error) {
    console.error("optionalCountry error:", error);
    return res.status(500).json({ message: "Server error (optionalCountry)" });
  }
}

module.exports = {
  resolveCountry,
  optionalCountry,
  clearCountryCache,
};
