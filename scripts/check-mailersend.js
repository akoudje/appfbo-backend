require("dotenv").config();

const { sendEmail, normalizeEmail } = require("../src/services/email.service");

async function main() {
  const apiKey = String(
    process.env.MAILERSEND_API_KEY ||
      process.env.MAILSENDER_API_KEY ||
      process.env.MAILER_SEND_API_KEY ||
      "",
  ).trim();
  const fromEmail = normalizeEmail(
    process.env.MAILERSEND_FROM_EMAIL ||
      process.env.MAILSENDER_FROM_EMAIL ||
      process.env.SMTP_FROM_EMAIL ||
      "",
  );
  const to = normalizeEmail(process.env.MAILERSEND_TEST_TO || fromEmail || "");

  console.log("[mailersend-check] configuration", {
    apiKeyPresent: Boolean(apiKey),
    fromEmail,
    testRecipient: to,
  });

  if (!apiKey) {
    throw new Error("MAILERSEND_API_KEY est manquant.");
  }
  if (!fromEmail) {
    throw new Error("MAILERSEND_FROM_EMAIL ou SMTP_FROM_EMAIL est manquant.");
  }
  if (!to) {
    throw new Error("MAILERSEND_TEST_TO est invalide.");
  }

  const result = await sendEmail({
    to,
    subject: "Test MailerSend FOREVER",
    body: "Ceci est un test de connexion MailerSend depuis appfbo-backend.",
    metadata: { preorderId: "smtp-diagnostic" },
  });

  console.log("[mailersend-check] résultat", {
    accepted: result.accepted,
    provider: result.provider,
    providerMessageId: result.providerMessageId,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    status: result.rawPayload?.status || null,
  });

  if (!result.accepted) process.exit(1);
}

main().catch((error) => {
  console.error("[mailersend-check] échec:", {
    name: error?.name || null,
    code: error?.code || null,
    message: error?.message || String(error),
  });
  process.exit(1);
});
