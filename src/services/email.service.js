// src/services/email.service.js
//
// Provider SMTP réel (MailerLite/SendGrid/SMTP classique) + mode simulation optionnel.

let nodemailer = null;
try {
  // eslint-disable-next-line global-require
  nodemailer = require("nodemailer");
} catch (_) {
  nodemailer = null;
}

let transporter = null;
let cachedTransportConfigKey = null;
let smtpBlockedUntil = 0;
let smtpBlockedReason = null;

const SMTP_AUTH_COOLDOWN_MS = Math.max(
  5 * 60 * 1000,
  Number.parseInt(process.env.SMTP_AUTH_COOLDOWN_SECONDS || "900", 10) * 1000,
);

function normalizeEmail(value = "") {
  const email = String(value || "").trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function parseBool(value, fallback = false) {
  if (value === null || value === undefined || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function emailSimulateEnabled() {
  return parseBool(process.env.EMAIL_SIMULATE, false);
}

function getSmtpConfig() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const portRaw = String(process.env.SMTP_PORT || "").trim();
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const secure = parseBool(process.env.SMTP_SECURE, false);
  const requireTls = parseBool(process.env.SMTP_REQUIRE_TLS, false);

  const port = Number.parseInt(portRaw || (secure ? "465" : "587"), 10);

  return {
    host,
    port: Number.isFinite(port) ? port : secure ? 465 : 587,
    secure,
    requireTls,
    user,
    pass,
  };
}

function smtpConfigured() {
  const cfg = getSmtpConfig();
  return Boolean(cfg.host && cfg.user && cfg.pass && cfg.port);
}

function getFromEnvelope() {
  const fromEmail = normalizeEmail(process.env.SMTP_FROM_EMAIL || "");
  const fromName = String(process.env.SMTP_FROM_NAME || "FOREVER").trim();

  if (!fromEmail) return null;
  if (!fromName) return fromEmail;
  return `${fromName} <${fromEmail}>`;
}

function getTransportConfigKey(cfg) {
  return [
    cfg.host,
    cfg.port,
    cfg.secure,
    cfg.requireTls,
    cfg.user,
    Boolean(cfg.pass),
  ].join("|");
}

function isSmtpAuthFailure(error) {
  const code = String(error?.code || "").toUpperCase();
  const responseCode = Number(error?.responseCode || 0);
  const message = String(error?.message || error?.response || "").toLowerCase();
  return (
    responseCode === 535 ||
    code === "EAUTH" ||
    message.includes("invalid login") ||
    message.includes("failed login") ||
    message.includes("too many failed login")
  );
}

function getSmtpBlockedResult() {
  if (!smtpBlockedUntil || Date.now() >= smtpBlockedUntil) return null;
  const retryAt = new Date(smtpBlockedUntil).toISOString();
  return {
    accepted: false,
    provider: "SMTP",
    providerMessageId: null,
    rawPayload: {
      retryAt,
      reason: smtpBlockedReason,
    },
    errorCode: "SMTP_AUTH_COOLDOWN",
    errorMessage:
      `Envoi email temporairement suspendu après échec d'authentification SMTP. Réessayez après ${retryAt}.`,
  };
}

function ensureTransporter() {
  if (!smtpConfigured()) return null;
  if (!nodemailer) return null;

  const cfg = getSmtpConfig();
  const key = getTransportConfigKey(cfg);

  if (transporter && cachedTransportConfigKey === key) return transporter;

  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: cfg.requireTls,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });
  cachedTransportConfigKey = key;

  return transporter;
}

async function sendEmail({ to, subject, body, html = null, metadata = {} }) {
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

  const from = getFromEnvelope();
  if (!from && !emailSimulateEnabled()) {
    return {
      accepted: false,
      provider: "SMTP",
      providerMessageId: null,
      rawPayload: null,
      errorCode: "SMTP_FROM_NOT_CONFIGURED",
      errorMessage: "SMTP_FROM_EMAIL est requis pour l'envoi réel.",
    };
  }

  if (smtpConfigured() && nodemailer) {
    try {
      const blocked = getSmtpBlockedResult();
      if (blocked) return blocked;

      const mailer = ensureTransporter();
      if (!mailer) {
        throw new Error("SMTP_TRANSPORT_UNAVAILABLE");
      }

      const messageId = `appfbo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const info = await mailer.sendMail({
        from,
        to: normalizedTo,
        subject: String(subject || "").trim() || "Notification commande FOREVER",
        text: String(body || ""),
        html: html ? String(html) : undefined,
        headers: {
          "X-AppFbo-PreorderId": String(metadata?.preorderId || ""),
          "X-AppFbo-Message-Id": messageId,
        },
      });

      return {
        accepted: true,
        provider: "SMTP",
        providerMessageId: info?.messageId || messageId,
        rawPayload: {
          envelope: info?.envelope || null,
          response: info?.response || null,
          accepted: info?.accepted || [],
          rejected: info?.rejected || [],
        },
        errorCode: null,
        errorMessage: null,
      };
    } catch (error) {
      if (isSmtpAuthFailure(error)) {
        smtpBlockedUntil = Date.now() + SMTP_AUTH_COOLDOWN_MS;
        smtpBlockedReason = error?.message || error?.response || "SMTP authentication failed";
        transporter = null;
        cachedTransportConfigKey = null;
      }

      return {
        accepted: false,
        provider: "SMTP",
        providerMessageId: null,
        rawPayload: {
          name: error?.name || null,
          code: error?.code || null,
          response: error?.response || null,
          responseCode: error?.responseCode || null,
        },
        errorCode: error?.code || "SMTP_SEND_FAILED",
        errorMessage: error?.message || "Échec d'envoi SMTP.",
      };
    }
  }

  if (!emailSimulateEnabled()) {
    return {
      accepted: false,
      provider: "SMTP",
      providerMessageId: null,
      rawPayload: null,
      errorCode: "EMAIL_PROVIDER_NOT_CONFIGURED",
      errorMessage:
        "Provider email non configuré. Définissez SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM_EMAIL.",
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
