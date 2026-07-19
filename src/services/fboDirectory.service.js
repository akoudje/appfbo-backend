// src/services/fboDirectory.service.js
// Client pour FBO Service, le registre externe faisant autorité pour les
// informations d'un FBO (nom, téléphone, email, grade). Toute donnée FBO
// affichée ou stockée ailleurs (préfacture, attestations...) doit transiter
// par ce client plutôt que par une copie locale potentiellement obsolète.

const FBO_SERVICE_URL = String(process.env.FBO_SERVICE_URL || "").trim().replace(/\/+$/, "");
const FBO_SERVICE_INTERNAL_TOKEN = String(
  process.env.FBO_SERVICE_INTERNAL_TOKEN || "",
).trim();
const FBO_SERVICE_TIMEOUT_MS = Number(process.env.FBO_SERVICE_TIMEOUT_MS || 8000);

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

// Le numéro FBO canonique (clé unique locale) est le numéro à 12 chiffres
// groupé par tirets, tel qu'affiché sur la carte de membre FBO.
function canonicalFboNumber(raw = "") {
  const digits = digitsOnly(raw);
  if (digits.length === 12) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9, 12)}`;
  }
  return String(raw || "").trim();
}

const VALID_GRADES = [
  "CLIENT_PRIVILEGIE",
  "ANIMATEUR_ADJOINT",
  "ANIMATEUR",
  "MANAGER_ADJOINT",
  "MANAGER",
];

function normalizeGrade(raw) {
  const normalized = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
  const normalizedText = String(raw || "")
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

  const aliases = {
    CLIENTPRIVILEGIE: "CLIENT_PRIVILEGIE",
    PREFERRED_CUSTOMER: "CLIENT_PRIVILEGIE",
    PREFERREDCUSTOMER: "CLIENT_PRIVILEGIE",
    ANIMATEURADJOINT: "ANIMATEUR_ADJOINT",
    ASSISTANT_SUPERVISOR: "ANIMATEUR_ADJOINT",
    ASSISTANTSUPERVISOR: "ANIMATEUR_ADJOINT",
    SUPERVISOR: "ANIMATEUR",
    MANAGERADJOINT: "MANAGER_ADJOINT",
    ASSISTANT_MANAGER: "MANAGER_ADJOINT",
    ASSISTANTMANAGER: "MANAGER_ADJOINT",
    UNRECOGNIZED_MANAGER: "MANAGER",
    UNRECOGNIZEDMANAGER: "MANAGER",
    RECOGNIZED_MANAGER: "MANAGER",
    RECOGNIZEDMANAGER: "MANAGER",
    SENIOR_MANAGER: "MANAGER",
    SENIORMANAGER: "MANAGER",
    SOARING_MANAGER: "MANAGER",
    SOARINGMANAGER: "MANAGER",
    DIAMOND_MANAGER: "MANAGER",
    DIAMONDMANAGER: "MANAGER",
    SAPPHIRE_MANAGER: "MANAGER",
    SAPPHIREMANAGER: "MANAGER",
  };

  if (VALID_GRADES.includes(normalized)) return normalized;
  if (
    normalizedText.includes("MANAGER") &&
    (normalizedText.includes("UNRECOGNIZED") ||
      normalizedText.includes("UNRECOGNISED") ||
      (normalizedText.includes("NON") && normalizedText.includes("RECONNU")))
  ) {
    return "MANAGER";
  }
  return aliases[normalized] || "";
}

async function fetchFboDirectoryProfile(numeroFbo) {
  if (!FBO_SERVICE_URL) {
    const err = new Error("Service FBO non configuré");
    err.statusCode = 503;
    throw err;
  }

  const headers = {};
  if (FBO_SERVICE_INTERNAL_TOKEN) {
    headers["x-internal-token"] = FBO_SERVICE_INTERNAL_TOKEN;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FBO_SERVICE_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(
      `${FBO_SERVICE_URL}/fbo/check/${encodeURIComponent(numeroFbo)}`,
      { headers, signal: controller.signal },
    );
  } catch (error) {
    const err = new Error(
      error?.name === "AbortError"
        ? "Service FBO trop lent"
        : "Service FBO indisponible",
    );
    err.statusCode = error?.name === "AbortError" ? 504 : 503;
    err.cause = error;
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  const rawText = await response.text();
  let payload = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const err = new Error(payload?.error || "Service FBO indisponible");
    err.statusCode = response.status || 502;
    throw err;
  }

  return payload;
}

function isFboDirectoryTemporarilyUnavailable(error) {
  const statusCode = Number(error?.statusCode || 0);
  return statusCode === 502 || statusCode === 503 || statusCode === 504;
}

module.exports = {
  digitsOnly,
  canonicalFboNumber,
  normalizeGrade,
  VALID_GRADES,
  fetchFboDirectoryProfile,
  isFboDirectoryTemporarilyUnavailable,
};
