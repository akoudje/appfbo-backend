// src/services/email.service.js
//
// Service email minimaliste:
// - mode "non configure" explicite (pas de faux positifs)
// - mode simulation optionnel via EMAIL_SIMULATE=true

function normalizeEmail(value = "") {
  const email = String(value || "").trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function emailConfigured() {
  return String(process.env.EMAIL_SIMULATE || "").trim().toLowerCase() === "true";
}

async function sendEmail({ to, subject, body, metadata = {} }) {
  const normalizedTo = normalizeEmail(to);
  if (!normalizedTo) {
    return {
      accepted: false,
      provider: "EMAIL",
      providerMessageId: null,
      rawPayload: null,
      errorCode: "INVALID_EMAIL_DESTINATION",
      errorMessage: "Adresse email destinataire invalide.",
    };
  }

  if (!emailConfigured()) {
    return {
      accepted: false,
      provider: "EMAIL",
      providerMessageId: null,
      rawPayload: null,
      errorCode: "EMAIL_PROVIDER_NOT_CONFIGURED",
      errorMessage:
        "Provider email non configuré. Activez EMAIL_SIMULATE=true ou configurez un provider SMTP.",
    };
  }

  console.log("[email][simulated] send", {
    to: normalizedTo,
    subject: String(subject || "").trim() || "(sans objet)",
    bodyLength: String(body || "").length,
    metadata,
  });

  return {
    accepted: true,
    provider: "EMAIL_SIMULATED",
    providerMessageId: `mail_${Date.now()}`,
    rawPayload: {
      simulated: true,
      to: normalizedTo,
      metadata,
    },
    errorCode: null,
    errorMessage: null,
  };
}

module.exports = {
  normalizeEmail,
  sendEmail,
};

