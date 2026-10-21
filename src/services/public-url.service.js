function getRequestOrigin(req = null) {
  const origin = req?.get?.("origin") || req?.headers?.origin || "";
  if (!origin) return "";
  try {
    return new URL(origin).origin;
  } catch {
    return "";
  }
}

function normalizeHttpsBaseUrl(value = "") {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function isAdminLikeOrigin(value = "") {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "admin.forevercivstore.com" || hostname.startsWith("admin.");
  } catch {
    return false;
  }
}

// Adresses Vercel (*.vercel.app) : les déploiements de prévisualisation sont
// protégés par une connexion Vercel. Un lien construit depuis l'une d'elles
// (action faite sur une prévisualisation) demanderait au client de se
// connecter à Vercel ; on retombe alors sur le domaine public.
function isVercelOrigin(value = "") {
  try {
    return new URL(value).hostname.toLowerCase().endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function isSafePublicFrontendOrigin(value = "") {
  const origin = normalizeHttpsBaseUrl(value);
  if (!origin) return false;
  if (isAdminLikeOrigin(origin)) return false;
  if (isVercelOrigin(origin)) return false;
  return true;
}

function publicFrontendBaseUrl(req = null) {
  const candidates = [
    process.env.TICKET_PUBLIC_BASE_URL,
    process.env.FRONTEND_PUBLIC_URL,
    process.env.PUBLIC_APP_URL,
    process.env.APP_PUBLIC_BASE_URL,
    getRequestOrigin(req),
    "https://forevercivstore.com",
  ];

  for (const candidate of candidates) {
    const origin = normalizeHttpsBaseUrl(candidate);
    if (origin && isSafePublicFrontendOrigin(origin)) return origin;
  }

  return "https://forevercivstore.com";
}

module.exports = {
  publicFrontendBaseUrl,
  isSafePublicFrontendOrigin,
};
