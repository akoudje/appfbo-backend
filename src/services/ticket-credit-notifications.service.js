// Notification best-effort (SMS + email) envoyée au porteur d'un billet
// converti en crédit à la clôture de son événement. Chaque canal est
// indépendant : l'échec de l'un ne doit jamais empêcher l'autre, ni faire
// échouer l'émission du crédit elle-même (appelé après la transaction qui
// crée le TicketCredit, jamais avant).

const { sendSms } = require("./sms.service");
const { sendTicketCreditIssuedEmail } = require("./ticket-email-notifications.service");
const { publicFrontendBaseUrl } = require("./public-url.service");

function formatDateOnly(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function buildCreditIssuedSmsMessage({ credit, originEvent, portalUrl }) {
  const eventTitle = originEvent?.title || "l'événement";
  const expiresLabel = formatDateOnly(credit.expiresAt);
  return `Votre billet pour ${eventTitle} n'a pas ete scanne. Il devient un credit valable jusqu'au ${expiresLabel}, echangeable pour la prochaine edition sur ${portalUrl}.`;
}

async function notifyCreditIssued({ credit, originEvent, countryCode } = {}) {
  const portalUrl = `${publicFrontendBaseUrl()}/tickets`;
  const results = { sms: null, email: null };

  if (credit.holderPhone) {
    try {
      results.sms = await sendSms({
        to: credit.holderPhone,
        message: buildCreditIssuedSmsMessage({ credit, originEvent, portalUrl }),
        countryCode,
      });
    } catch (error) {
      console.error("[ticket-credit-notifications] sms error:", error);
      results.sms = { error: error.message };
    }
  }

  if (credit.holderEmail) {
    try {
      results.email = await sendTicketCreditIssuedEmail({ credit, originEvent });
    } catch (error) {
      console.error("[ticket-credit-notifications] email error:", error);
      results.email = { error: error.message };
    }
  }

  return results;
}

module.exports = { notifyCreditIssued };
