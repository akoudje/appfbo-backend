// src/services/email-templates/layout.js
//
// Système de composants HTML partagé pour tous les emails transactionnels de
// l'application. Avant ce module, chaque flux (précommande, ticket événement,
// OTP, restitution...) réimplémentait sa propre mise en page HTML, avec des
// résultats incohérents (deux identités visuelles différentes, et plusieurs
// emails envoyés sans aucun style). Toute nouvelle notification email doit
// passer par renderLayout() + renderButton()/renderHighlightBox() plutôt que
// d'écrire sa propre page HTML.

function escapeHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPublicAssetUrl(filename = "") {
  const cleanFilename = String(filename || "").trim().replace(/^\/+/, "");
  if (!cleanFilename) return "";

  const base =
    String(process.env.EMAIL_PUBLIC_ASSETS_BASE_URL || "").trim() ||
    String(process.env.FRONTEND_PUBLIC_URL || "").trim() ||
    String(process.env.APP_PUBLIC_BASE_URL || "").trim() ||
    "https://appfbo-frontend.vercel.app";

  return `${base.replace(/\/+$/, "")}/${cleanFilename}`;
}

function brandLogoUrl() {
  return (
    String(process.env.EMAIL_BRAND_LOGO_URL || "").trim() ||
    buildPublicAssetUrl("forever-corporate-logo.png")
  );
}

// Palette de marque unique pour tous les emails : jaune accent + fond blanc,
// repris du design déjà existant (le plus abouti des deux) sur l'email de
// confirmation de billet, plutôt que le crème/gris plus terne de l'email
// précommande. Un seul système, pas deux.
const BRAND = {
  accent: "#FFC600",
  accentDark: "#8a7a2e",
  ink: "#111111",
  bodyText: "#2c2c2c",
  mutedText: "#6b6b6b",
  cardBorder: "#ececec",
  envelopeBg: "#f1f1ef",
  headerBg: "#fffdf7",
  highlightBg: "#fff7d6",
  highlightBorder: "#f0cf57",
  fontFamily: "Arial, Helvetica, sans-serif",
};

function renderButton({ href, label }) {
  const safeHref = String(href || "").trim();
  const safeLabel = String(label || "").trim();
  if (!safeHref || !safeLabel) return "";

  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 6px;">
    <tr>
      <td style="border-radius:12px;background:${BRAND.accent};">
        <a href="${escapeHtml(safeHref)}" style="display:inline-block;padding:14px 26px;font-weight:800;font-size:15px;color:${BRAND.ink};text-decoration:none;border-radius:12px;">
          ${escapeHtml(safeLabel)}
        </a>
      </td>
    </tr>
  </table>`;
}

// Encart utilisé pour tout ce que le destinataire doit noter/présenter : code
// de retrait, code d'encaissement, code OTP... Un seul composant, réutilisé
// partout au lieu de styles ad hoc par email.
function renderHighlightBox({ label, value }) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 16px;">
    <tr>
      <td style="background:${BRAND.highlightBg};border:1px solid ${BRAND.highlightBorder};border-radius:10px;padding:14px 18px;text-align:center;">
        <div style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.accentDark};">${escapeHtml(label)}</div>
        <div style="font-size:26px;font-weight:800;letter-spacing:0.05em;color:${BRAND.ink};font-family:'Courier New',Courier,monospace;">${escapeHtml(value)}</div>
      </td>
    </tr>
  </table>`;
}

// Une ligne "Code XXX: valeur" (code de retrait, code encaissement...) est un
// code que le destinataire doit noter/présenter — on la sort du paragraphe
// pour la mettre en évidence dans un encart plutôt que de la noyer dans du
// texte plat.
const CODE_LINE_PATTERN = /^(Code[^:]{0,40}):\s*(.+)$/i;

function textToHtml(value = "") {
  const blocks = String(value || "")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const lines = block.split("\n");
      const pieces = [];
      let textBuffer = [];

      const flushText = () => {
        if (!textBuffer.length) return;
        pieces.push(
          `<p style="margin:0 0 14px;color:${BRAND.bodyText};line-height:1.6;font-size:15px;">${escapeHtml(
            textBuffer.join("\n"),
          ).replace(/\n/g, "<br/>")}</p>`,
        );
        textBuffer = [];
      };

      for (const line of lines) {
        const match = line.match(CODE_LINE_PATTERN);
        if (match) {
          flushText();
          pieces.push(renderHighlightBox({ label: match[1].trim(), value: match[2].trim() }));
        } else {
          textBuffer.push(line);
        }
      }
      flushText();

      return pieces.join("");
    })
    .join("");
}

function renderFooter({ supportPhone = "", supportEmail = "" } = {}) {
  const contactBits = [
    supportPhone ? `Tél. ${escapeHtml(supportPhone)}` : null,
    supportEmail
      ? `<a href="mailto:${escapeHtml(supportEmail)}" style="color:${BRAND.mutedText};">${escapeHtml(supportEmail)}</a>`
      : null,
  ]
    .filter(Boolean)
    .join(" &middot; ");

  return `<tr>
    <td style="padding:18px 32px 26px;border-top:1px solid #f1f1f1;background:#fafafa;">
      <p style="margin:0 0 4px;font-size:12px;color:${BRAND.mutedText};">FOREVER Côte d'Ivoire &mdash; notification transactionnelle automatique.</p>
      ${contactBits ? `<p style="margin:0;font-size:12px;color:${BRAND.mutedText};">${contactBits}</p>` : ""}
    </td>
  </tr>`;
}

/**
 * Gabarit commun à tous les emails transactionnels.
 * - previewText : texte d'aperçu caché (snippet affiché par la boîte mail avant ouverture).
 * - eyebrow : petit label au-dessus du titre (ex. "FOREVER EVENTS").
 * - title : titre principal (h1).
 * - bodyHtml : contenu HTML déjà construit (paragraphes, boutons, tableaux...).
 * - headerTag : texte affiché à droite du logo dans l'en-tête (ex. "Précommande PO-...").
 * - supportPhone / supportEmail : coordonnées affichées dans le pied de page si fournies.
 */
function renderLayout({
  previewText = "",
  eyebrow = "",
  title = "",
  bodyHtml = "",
  headerTag = "",
  supportPhone = "",
  supportEmail = "",
}) {
  const logoUrl = brandLogoUrl();
  const safeTitle = escapeHtml(title || "");

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle || "FOREVER"}</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.envelopeBg};font-family:${BRAND.fontFamily};">
    ${previewText ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(previewText)}</div>` : ""}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.envelopeBg};padding:28px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid ${BRAND.cardBorder};">
            <tr>
              <td style="height:6px;background:${BRAND.accent};line-height:0;font-size:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:22px 32px;border-bottom:1px solid #f1f1f1;background:${BRAND.headerBg};">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td align="left">
                      <img src="${escapeHtml(logoUrl)}" alt="FOREVER" style="height:40px;max-width:180px;object-fit:contain;" />
                    </td>
                    ${headerTag ? `<td align="right" style="color:${BRAND.mutedText};font-size:12px;">${escapeHtml(headerTag)}</td>` : ""}
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px 8px;">
                ${eyebrow ? `<div style="margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.accentDark};">${escapeHtml(eyebrow)}</div>` : ""}
                ${title ? `<h1 style="margin:0 0 18px;font-size:21px;line-height:1.3;color:${BRAND.ink};">${safeTitle}</h1>` : ""}
                ${bodyHtml}
              </td>
            </tr>
            ${renderFooter({ supportPhone, supportEmail })}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

module.exports = {
  BRAND,
  escapeHtml,
  buildPublicAssetUrl,
  brandLogoUrl,
  renderLayout,
  renderButton,
  renderHighlightBox,
  textToHtml,
  renderFooter,
};
