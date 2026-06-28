const { normalizeEmail, sendEmail } = require("./email.service");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value) {
  if (!value) return "Date à confirmer";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date à confirmer";
  return date.toLocaleString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ticketOrderPublicUrl({ order, publicUrl }) {
  const base = String(publicUrl || "").replace(/\/+$/, "");
  if (!base || !order?.orderNumber) return "";
  const countryCode = order.country?.code || "CIV";
  return `${base}/tickets/${encodeURIComponent(order.orderNumber)}?country=${encodeURIComponent(countryCode)}`;
}

function buildTicketEmailText({ order, tickets, ticketUrl }) {
  const event = order.event || {};
  const lines = [
    `Bonjour ${order.buyerFullName || ""},`,
    "",
    "Votre paiement est confirmé. Vos tickets sont maintenant actifs.",
    "",
    `Événement : ${event.title || "Événement Forever"}`,
    `Date : ${formatDateTime(event.startsAt)}`,
    `Lieu : ${[event.venueName, event.venueAddress].filter(Boolean).join(", ") || "Lieu à confirmer"}`,
    `Commande : ${order.orderNumber}`,
    "",
    "Tickets :",
    ...tickets.map((ticket, index) => (
      `${index + 1}. ${ticket.ticketType?.label || order.ticketType?.label || "Ticket"} - ${ticket.ticketCode}`
    )),
    "",
    ticketUrl ? `Afficher et télécharger vos tickets : ${ticketUrl}` : "",
    "",
    "Présentez le QR code de chaque ticket à l'entrée.",
    "Ticket personnel, QR code unique et contrôlé à l'accès.",
    "",
    "FOREVER",
  ];
  return lines.filter((line) => line !== null).join("\n");
}

function buildTicketEmailHtml({ order, tickets, ticketUrl }) {
  const event = order.event || {};
  const venue = [event.venueName, event.venueAddress].filter(Boolean).join(", ") || "Lieu à confirmer";
  const ticketRows = tickets
    .map((ticket, index) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #eee;color:#666;">${index + 1}</td>
        <td style="padding:12px 0;border-bottom:1px solid #eee;font-weight:700;color:#111;">
          ${escapeHtml(ticket.ticketType?.label || order.ticketType?.label || "Ticket")}
        </td>
        <td style="padding:12px 0;border-bottom:1px solid #eee;font-family:monospace;color:#111;">
          ${escapeHtml(ticket.ticketCode)}
        </td>
      </tr>
    `)
    .join("");

  return `
    <div style="margin:0;padding:0;background:#f5f0e6;font-family:Arial,sans-serif;color:#111;">
      <div style="max-width:680px;margin:0 auto;padding:28px 16px;">
        <div style="background:#050505;border-radius:24px;overflow:hidden;">
          <div style="height:10px;background:#FFC600;"></div>
          <div style="padding:32px;">
            <div style="color:#FFC600;font-size:13px;font-weight:900;letter-spacing:3px;text-transform:uppercase;">
              FOREVER EVENTS
            </div>
            <h1 style="margin:14px 0 8px;color:#fff;font-size:30px;line-height:1.2;">
              ${escapeHtml(event.title || "Événement Forever")}
            </h1>
            <p style="margin:0;color:#d8d8d8;font-size:15px;line-height:1.6;">
              Votre paiement est confirmé. Vos tickets sont maintenant actifs.
            </p>
          </div>
        </div>

        <div style="background:#fff;border-radius:20px;margin-top:18px;padding:26px;border:1px solid #e8e2d8;">
          <p style="margin:0 0 18px;font-size:16px;">Bonjour <strong>${escapeHtml(order.buyerFullName || "")}</strong>,</p>
          <div style="display:block;margin-bottom:20px;">
            <div style="margin-bottom:8px;"><strong>Date :</strong> ${escapeHtml(formatDateTime(event.startsAt))}</div>
            <div style="margin-bottom:8px;"><strong>Lieu :</strong> ${escapeHtml(venue)}</div>
            <div><strong>Commande :</strong> ${escapeHtml(order.orderNumber)}</div>
          </div>

          <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:14px;">
            <thead>
              <tr>
                <th align="left" style="padding-bottom:10px;color:#777;font-size:12px;text-transform:uppercase;">#</th>
                <th align="left" style="padding-bottom:10px;color:#777;font-size:12px;text-transform:uppercase;">Billet</th>
                <th align="left" style="padding-bottom:10px;color:#777;font-size:12px;text-transform:uppercase;">Code</th>
              </tr>
            </thead>
            <tbody>${ticketRows}</tbody>
          </table>

          ${ticketUrl ? `
            <div style="margin-top:26px;">
              <a href="${escapeHtml(ticketUrl)}" style="display:inline-block;background:#FFC600;color:#111;text-decoration:none;font-weight:900;border-radius:12px;padding:14px 20px;">
                Afficher et télécharger mes tickets
              </a>
            </div>
          ` : ""}

          <p style="margin:24px 0 0;color:#666;font-size:13px;line-height:1.6;">
            Présentez le QR code de chaque ticket à l'entrée. Ticket personnel, QR code unique et contrôlé à l'accès.
          </p>
        </div>
      </div>
    </div>
  `;
}

async function sendTicketOrderEmail({ order, publicUrl }) {
  const to = normalizeEmail(order?.buyerEmail || order?.holderEmail || "");
  const tickets = Array.isArray(order?.tickets) ? order.tickets : [];
  if (!to || !order || tickets.length === 0) {
    return { sent: false, skipped: true, reason: !to ? "NO_EMAIL" : "NO_TICKETS" };
  }

  const ticketUrl = ticketOrderPublicUrl({ order, publicUrl });
  const subject = `Vos tickets - ${order.event?.title || order.orderNumber}`;
  const body = buildTicketEmailText({ order, tickets, ticketUrl });
  const html = buildTicketEmailHtml({ order, tickets, ticketUrl });

  const result = await sendEmail({
    to,
    subject,
    body,
    html,
    metadata: {
      ticketOrderId: order.id,
      ticketOrderNumber: order.orderNumber,
      eventId: order.eventId,
    },
  });

  return {
    sent: Boolean(result?.accepted),
    skipped: false,
    to,
    provider: result?.provider || null,
    errorCode: result?.errorCode || null,
    errorMessage: result?.errorMessage || null,
  };
}

module.exports = {
  sendTicketOrderEmail,
};
