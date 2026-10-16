const { normalizeEmail, sendEmail } = require("./email.service");
const { isSafePublicFrontendOrigin, publicFrontendBaseUrl } = require("./public-url.service");
const { signTicketOrderAccessToken } = require("./ticket-order-ticketing.service");
const { renderLayout, renderButton, escapeHtml } = require("./email-templates/layout");

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
  const base = isSafePublicFrontendOrigin(publicUrl)
    ? String(publicUrl || "").replace(/\/+$/, "")
    : publicFrontendBaseUrl();
  if (!base || !order?.orderNumber) return "";
  const countryCode = order.country?.code || "CIV";
  const token = signTicketOrderAccessToken(order.orderNumber);
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : "";
  return `${base}/tickets/${encodeURIComponent(order.orderNumber)}?country=${encodeURIComponent(countryCode)}${tokenParam}`;
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
    ticketUrl ? `Afficher vos billets : ${ticketUrl}` : "",
    "",
    "Présentez le QR code de chaque ticket à l'entrée.",
    "Chaque ticket possède un QR code unique. Une fois scanné, il ne peut plus être réutilisé.",
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

  const bodyHtml = `
    <p style="margin:0 0 18px;font-size:15px;color:#2c2c2c;">Bonjour <strong>${escapeHtml(order.buyerFullName || "")}</strong>, votre paiement est confirmé et vos tickets sont maintenant actifs.</p>
    <div style="margin:0 0 18px;font-size:14px;color:#2c2c2c;line-height:1.7;">
      <div><strong>Date :</strong> ${escapeHtml(formatDateTime(event.startsAt))}</div>
      <div><strong>Lieu :</strong> ${escapeHtml(venue)}</div>
      <div><strong>Commande :</strong> ${escapeHtml(order.orderNumber)}</div>
    </div>
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:6px;">
      <thead>
        <tr>
          <th align="left" style="padding-bottom:10px;color:#777;font-size:12px;text-transform:uppercase;">#</th>
          <th align="left" style="padding-bottom:10px;color:#777;font-size:12px;text-transform:uppercase;">Billet</th>
          <th align="left" style="padding-bottom:10px;color:#777;font-size:12px;text-transform:uppercase;">Code</th>
        </tr>
      </thead>
      <tbody>${ticketRows}</tbody>
    </table>
    ${renderButton({ href: ticketUrl, label: "Afficher mes billets" })}
    <p style="margin:18px 0 0;color:#6b6b6b;font-size:13px;line-height:1.6;">
      Présentez le QR code de chaque ticket à l'entrée. Chaque QR code est unique et valable pour une seule entrée.
    </p>
  `;

  return renderLayout({
    previewText: `Vos tickets pour ${event.title || "votre événement"} sont confirmés.`,
    eyebrow: "FOREVER EVENTS",
    title: event.title || "Événement Forever",
    bodyHtml,
    headerTag: order.orderNumber,
  });
}

async function sendTicketOrderEmail({ order, publicUrl, recipientEmail } = {}) {
  const to = normalizeEmail(recipientEmail || order?.buyerEmail || order?.holderEmail || "");
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

async function sendTicketOrderAccessEmail({ order, publicUrl }) {
  if (order.status === "PAID" && !order.ticketIssueCode && (order.tickets || []).length) {
    return sendTicketOrderEmail({ order, publicUrl });
  }

  const to = normalizeEmail(order.buyerEmail || order.holderEmail || "");
  if (!to) return { sent: false, skipped: true };

  const url = ticketOrderPublicUrl({ order, publicUrl });
  const eventTitle = order.event?.title || order.orderNumber;
  const body = [
    `Bonjour ${order.buyerFullName},`,
    "",
    `Retrouvez votre achat ${order.orderNumber} et son état actuel depuis ce lien sécurisé :`,
    url,
    "",
    "Conservez ce lien personnel.",
  ].join("\n");

  const bodyHtml = `
    <p style="margin:0 0 14px;color:#2c2c2c;line-height:1.6;font-size:15px;">Bonjour <strong>${escapeHtml(order.buyerFullName || "")}</strong>,</p>
    <p style="margin:0 0 14px;color:#2c2c2c;line-height:1.6;font-size:15px;">Retrouvez votre achat <strong>${escapeHtml(order.orderNumber)}</strong> et son état actuel.</p>
    ${renderButton({ href: url, label: "Afficher mon achat" })}
    <p style="margin:18px 0 0;color:#6b6b6b;font-size:13px;line-height:1.6;">Ce lien est personnel, conservez-le pour vous uniquement.</p>
  `;
  const html = renderLayout({
    previewText: `Retrouvez votre achat ${order.orderNumber}`,
    eyebrow: "FOREVER EVENTS",
    title: eventTitle,
    bodyHtml,
    headerTag: order.orderNumber,
  });

  const result = await sendEmail({
    to,
    subject: `Votre achat - ${eventTitle}`,
    body,
    html,
  });
  return { sent: Boolean(result?.accepted) };
}

module.exports = {
  sendTicketOrderEmail,
  sendTicketOrderAccessEmail,
};
