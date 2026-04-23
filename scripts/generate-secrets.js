#!/usr/bin/env node
// scripts/generate-secrets.js
// Génère des valeurs cryptographiquement sûres pour toutes les variables
// secrètes du projet. Imprime le bloc .env prêt à copier-coller.
//
// Usage:
//   node scripts/generate-secrets.js
//   node scripts/generate-secrets.js --rotate JWT_SECRET CUSTOMER_JWT_SECRET

"use strict";

const crypto = require("crypto");

const ALL_SECRETS = [
  { key: "JWT_SECRET",                  bytes: 64, description: "Token admin JWT" },
  { key: "CUSTOMER_JWT_SECRET",         bytes: 64, description: "Token client JWT" },
  { key: "CUSTOMER_OTP_PEPPER",         bytes: 64, description: "Pepper HMAC OTP client" },
  { key: "WAVE_WEBHOOK_SECRET",         bytes: 32, description: "Vérification signatures Wave" },
  { key: "FBO_SERVICE_INTERNAL_TOKEN",  bytes: 64, description: "Token service interne FBO" },
  { key: "SHORT_PAYMENT_LINK_SECRET",   bytes: 32, description: "Signature liens courts Wave" },
];

function generateHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function main() {
  const args = process.argv.slice(2);
  const rotateMode = args.includes("--rotate");
  const targetKeys = rotateMode
    ? args.filter((a) => !a.startsWith("--"))
    : null;

  const secrets = targetKeys
    ? ALL_SECRETS.filter((s) => targetKeys.includes(s.key))
    : ALL_SECRETS;

  if (secrets.length === 0) {
    const valid = ALL_SECRETS.map((s) => s.key).join(", ");
    console.error(`Aucun secret reconnu. Clés valides : ${valid}`);
    process.exit(1);
  }

  console.log("\n# ─── Secrets générés le", new Date().toISOString(), "───");
  console.log("# Copiez ces valeurs dans votre fichier .env (Render / local)\n");

  for (const { key, bytes, description } of secrets) {
    const value = generateHex(bytes);
    console.log(`# ${description}`);
    console.log(`${key}=${value}\n`);
  }

  console.log("# ─── IMPORTANT ──────────────────────────────────────────────");
  console.log("# Après rotation, redémarrez tous les services qui utilisent");
  console.log("# ces secrets. Les tokens JWT existants seront invalidés.");
  console.log("# ─────────────────────────────────────────────────────────────\n");
}

main();
