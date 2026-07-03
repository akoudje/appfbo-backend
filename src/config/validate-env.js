// src/config/validate-env.js
// Vérifie que toutes les variables d'environnement critiques sont présentes
// et conformes avant de démarrer le serveur.
// Le processus s'arrête immédiatement si une variable est absente ou trop faible.

"use strict";

const KNOWN_WEAK_SECRETS = new Set([
  "change_me_long_random",
  "change_me",
  "secret",
  "mysecret",
  "jwt_secret",
  "replace_with_strong_random_secret",
  "replace_with_another_strong_random_secret",
  "replace_with_strong_random_pepper",
  "appfbo_customer_otp_dev_only",
  "ChangeMeNow123!",
  "password",
  "123456",
]);

const MIN_SECRET_LENGTH = 32;

function fatal(message) {
  console.error(`\n[validate-env] FATAL: ${message}`);
  console.error("[validate-env] Arrêt du serveur pour protéger l'application.\n");
  process.exit(1);
}

function checkSecret(name, value, { minLength = MIN_SECRET_LENGTH, required = true } = {}) {
  if (!value || !value.trim()) {
    if (required) fatal(`${name} est manquant ou vide.`);
    return;
  }

  const trimmed = value.trim();

  if (KNOWN_WEAK_SECRETS.has(trimmed.toLowerCase()) || KNOWN_WEAK_SECRETS.has(trimmed)) {
    fatal(`${name} utilise une valeur par défaut non sécurisée : "${trimmed}". Générez un nouveau secret avec : node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`);
  }

  if (trimmed.length < minLength) {
    fatal(`${name} est trop court (${trimmed.length} chars). Minimum requis : ${minLength} chars.`);
  }
}

function checkRequired(name, value) {
  if (!value || !String(value).trim()) {
    fatal(`${name} est manquant ou vide.`);
  }
}

function warn(message) {
  console.warn(`[validate-env] WARN: ${message}`);
}

function validateEnv() {
  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";

  // ─── Secrets cryptographiques ────────────────────────────────────────────
  checkSecret("JWT_SECRET",            process.env.JWT_SECRET,            { minLength: 32 });
  checkSecret("CUSTOMER_JWT_SECRET",   process.env.CUSTOMER_JWT_SECRET,   { minLength: 32 });
  checkSecret("CUSTOMER_OTP_PEPPER",   process.env.CUSTOMER_OTP_PEPPER,   { minLength: 32 });

  // ─── Base de données ──────────────────────────────────────────────────────
  checkRequired("DATABASE_URL", process.env.DATABASE_URL);

  // ─── Webhooks paiement ────────────────────────────────────────────────────
  checkSecret("WAVE_WEBHOOK_SECRET", process.env.WAVE_WEBHOOK_SECRET, { minLength: 20 });

  // ─── Service interne ──────────────────────────────────────────────────────
  checkSecret("FBO_SERVICE_INTERNAL_TOKEN", process.env.FBO_SERVICE_INTERNAL_TOKEN, {
    minLength: 32,
    required: false, // optionnel si fbo-service non utilisé
  });

  const orangeConfigured = Boolean(
    process.env.ORANGE_CLIENT_ID &&
      process.env.ORANGE_CLIENT_SECRET &&
      process.env.ORANGE_SENDER_ADDRESS &&
      process.env.ORANGE_SENDER_NUMBER,
  );
  if (orangeConfigured && !String(process.env.ORANGE_WEBHOOK_TOKEN || "").trim()) {
    warn("ORANGE_WEBHOOK_TOKEN est absent: Orange acceptera les SMS, mais le statut de livraison ne sera pas remonté.");
  }
  if (orangeConfigured && !String(process.env.BACKEND_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").trim()) {
    warn("BACKEND_PUBLIC_URL/RENDER_EXTERNAL_URL absent: le webhook de livraison SMS Orange peut être impossible à joindre.");
  }

  // ─── Checks spécifiques à la production ──────────────────────────────────
  if (isProd) {
    // Flags de dev dangereux doivent être désactivés
    if (String(process.env.ALLOW_HEADER_AUTH || "").toLowerCase() === "true") {
      fatal("ALLOW_HEADER_AUTH=true est interdit en production.");
    }
    if (String(process.env.ALLOW_QUERY_TOKEN_AUTH || "").toLowerCase() === "true") {
      fatal("ALLOW_QUERY_TOKEN_AUTH=true est interdit en production.");
    }
    if (String(process.env.ENABLE_SEED_SUPER_ADMIN || "").toLowerCase() === "true") {
      fatal("ENABLE_SEED_SUPER_ADMIN=true est interdit en production.");
    }
    if (String(process.env.ENABLE_WAVE_SIMULATION || "").toLowerCase() === "true") {
      fatal("ENABLE_WAVE_SIMULATION=true est interdit en production.");
    }
    if (String(process.env.EMAIL_SIMULATE || "").toLowerCase() === "true") {
      fatal("EMAIL_SIMULATE=true est interdit en production.");
    }

    // NODE_ENV doit être explicitement "production"
    if (process.env.NODE_ENV !== "production") {
      fatal(`NODE_ENV doit être "production" en prod, reçu : "${process.env.NODE_ENV}".`);
    }
  }

  console.log("[validate-env] ✅ Toutes les variables d'environnement sont valides.");
}

module.exports = { validateEnv };
