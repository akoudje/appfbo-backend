require("dotenv").config();

const nodemailer = require("nodemailer");

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} est manquant.`);
  }
  return value;
}

async function main() {
  const host = required("SMTP_HOST");
  const port = Number.parseInt(String(process.env.SMTP_PORT || "587"), 10);
  const user = required("SMTP_USER");
  const pass = required("SMTP_PASS");
  const secure = bool(process.env.SMTP_SECURE, false);
  const requireTLS = bool(process.env.SMTP_REQUIRE_TLS, false);
  const from = required("SMTP_FROM_EMAIL");

  console.log("[smtp-check] configuration", {
    host,
    port,
    secure,
    requireTLS,
    user,
    from,
    passwordPresent: Boolean(pass),
  });

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS,
    auth: { user, pass },
  });

  await transporter.verify();
  console.log("[smtp-check] connexion SMTP valide.");
}

main().catch((error) => {
  console.error("[smtp-check] échec SMTP:", {
    name: error?.name || null,
    code: error?.code || null,
    responseCode: error?.responseCode || null,
    message: error?.message || String(error),
  });
  process.exit(1);
});
