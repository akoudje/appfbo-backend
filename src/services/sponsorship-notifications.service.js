// src/services/sponsorship-notifications.service.js
// Notifications du parrainage, au parrain ET au filleul, par SMS et par email :
// - approbation (fusionnée avec l'achat) : n° FBO du filleul, commande
//   préfacturée, montant et lien de paiement ; l'email joint la fiche
//   d'agrément cachetée ;
// - validation : achat payé, lien parrain-filleul enregistré.
// Un échec d'envoi n'interrompt jamais le parcours (journalisé).

const prisma = require("../prisma");
const { sendEmail } = require("./email.service");
const { notifySms, addSponsorshipLog, findSponsorPhone } = require("./sponsorship.service");
const { buildSponsorshipAgreementPdfBuffer } = require("./sponsorship-agreement-pdf.service");

const fcfa = (value) => `${new Intl.NumberFormat("fr-FR").format(Math.round(Number(value) || 0))} F`;

// Les SMS sont limités à 160 caractères (tronqués au-delà) : première variante
// qui tient, pour ne jamais couper le lien de paiement.
const SMS_MAX = 160;
function fitSms(candidates) {
  return candidates.find((text) => text.length <= SMS_MAX) || candidates[candidates.length - 1];
}

const PAYMENT_LABELS = {
  WAVE: "Wave",
  BANK_TRANSFER: "virement bancaire",
  ECOBANK_PAY: "Ecobank Pay",
  PI_SPI: "PI-SPI",
  ESPECES: "espèces, à la caisse",
  ORANGE_MONEY: "Orange Money",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function emailHtml({ greeting, paragraphs, rows = [], cta = null }) {
  const rowsHtml = rows.length
    ? `<table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:520px">${rows
        .map(([label, value]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b6b6b">${escapeHtml(label)}</td><td style="padding:6px 0;font-weight:600">${escapeHtml(value)}</td></tr>`)
        .join("")}</table>`
    : "";
  const ctaHtml = cta
    ? `<p style="margin:20px 0"><a href="${escapeHtml(cta.href)}" style="background:#FFC600;color:#000;padding:12px 20px;text-decoration:none;font-weight:600;border-radius:6px;display:inline-block">${escapeHtml(cta.label)}</a></p>`
    : "";
  return `<div style="font-family:Helvetica,Arial,sans-serif;color:#171717;font-size:15px;line-height:1.5">
<p style="font-size:13px;letter-spacing:3px;margin:0 0 16px">FOREVER</p>
<p>${escapeHtml(greeting)}</p>
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")}
${rowsHtml}${ctaHtml}
<p style="color:#6b6b6b;font-size:13px">Forever Living Products</p></div>`;
}

function emailText({ greeting, paragraphs, rows = [], cta = null }) {
  return [greeting, "", ...paragraphs, "", ...rows.map(([l, v]) => `${l} : ${v}`), cta ? `\n${cta.label} : ${cta.href}` : ""].join("\n");
}

async function safeEmail(args, context) {
  if (!args.to) return { channel: "EMAIL", to: null, ok: false, skipped: true };
  try {
    const result = await sendEmail(args);
    return { channel: "EMAIL", to: args.to, ok: Boolean(result?.accepted) };
  } catch (error) {
    console.error("[sponsorship] email non envoyé", { context, error: error?.message });
    return { channel: "EMAIL", to: args.to, ok: false };
  }
}

async function safeSms({ to, message, countryCode }) {
  if (!to) return { channel: "SMS", to: null, ok: false, skipped: true };
  await notifySms({ to, message, countryCode });
  return { channel: "SMS", to, ok: true };
}

async function countryInfo(countryId) {
  const country = await prisma.country.findUnique({ where: { id: countryId }, select: { code: true, name: true } });
  return { countryCode: country?.code || "CIV", countryName: country?.name || "" };
}

async function approverName(approvedById) {
  if (!approvedById) return "";
  const admin = await prisma.adminUser.findUnique({ where: { id: approvedById }, select: { fullName: true, email: true } });
  return admin?.fullName || admin?.email || "";
}

// Approbation + achat préfacturé : un seul message, aux deux.
// order : { preorderNumber, amountToPayFcfa, paymentMode }, paymentLink : lien
// Wave / dépôt de preuve, ou null (paiement en caisse).
async function notifySponsorshipApproved({ sponsorshipId, order, paymentLink }) {
  const s = await prisma.sponsorship.findUnique({ where: { id: sponsorshipId } });
  if (!s) return [];
  const { countryCode, countryName } = await countryInfo(s.countryId);
  const recruitName = `${s.firstNames} ${s.lastName}`;
  const amount = fcfa(order.amountToPayFcfa);
  const paymentLabel = PAYMENT_LABELS[String(order.paymentMode || "").toUpperCase()] || order.paymentMode || "";
  const pay = paymentLink ? `a payer: ${paymentLink}` : "a regler en caisse.";

  const pdf = await buildSponsorshipAgreementPdfBuffer({
    sponsorship: s,
    approverName: await approverName(s.approvedById),
    countryName: countryName || "Côte d'Ivoire",
  }).catch((error) => {
    console.error("[sponsorship] fiche PDF non générée", { id: s.id, error: error?.message });
    return null;
  });
  const attachments = pdf ? [{ filename: `agrement-${s.recruitFboNumero}.pdf`, content: pdf }] : [];

  const rows = [
    ["N° FBO du filleul", s.recruitFboNumero],
    ["Commande", order.preorderNumber],
    ["Montant à payer", amount],
    ["Paiement", paymentLabel],
  ];
  const cta = paymentLink ? { label: "Payer la commande", href: paymentLink } : null;
  const finalNote = "Le parrainage sera validé dès le paiement de cette commande.";

  const results = await Promise.all([
    safeSms({
      to: s.mobile,
      countryCode,
      message: fitSms([
        `FOREVER: bienvenue ${s.firstNames}! Votre n° FBO: ${s.recruitFboNumero}. Commande ${order.preorderNumber} ${amount} ${pay}`,
        `FOREVER: bienvenue! N° FBO ${s.recruitFboNumero}. Cde ${order.preorderNumber} ${amount} ${pay}`,
        `FOREVER: FBO ${s.recruitFboNumero}. ${amount} ${pay}`,
      ]),
    }),
    safeSms({
      to: s.sponsorPhone || (await findSponsorPhone(s)),
      countryCode,
      message: fitSms([
        `FOREVER: parrainage de ${recruitName} approuve (FBO ${s.recruitFboNumero}). Cde ${order.preorderNumber} ${amount} ${pay}`,
        `FOREVER: parrainage approuve, FBO ${s.recruitFboNumero}. Cde ${order.preorderNumber} ${amount} ${pay}`,
        `FOREVER: FBO ${s.recruitFboNumero} approuve. ${amount} ${pay}`,
      ]),
    }),
    safeEmail(
      {
        to: s.email,
        subject: `Bienvenue chez Forever : votre n° FBO ${s.recruitFboNumero}`,
        ...(() => {
          const content = {
            greeting: `Bonjour ${recruitName},`,
            paragraphs: [
              `Votre inscription comme distributeur Forever, parrainée par ${s.sponsorNom}, est approuvée. Vous trouverez votre fiche d'agrément en pièce jointe.`,
              `Votre premier achat est prêt : ${finalNote.toLowerCase()}`,
            ],
            rows,
            cta,
          };
          return { html: emailHtml(content), body: emailText(content) };
        })(),
        attachments,
        metadata: { type: "SPONSORSHIP_APPROVED", sponsorshipId: s.id, recipient: "RECRUIT" },
      },
      "recruit-approved",
    ),
    safeEmail(
      {
        to: s.sponsorEmail,
        subject: `Parrainage approuvé : ${recruitName} (FBO ${s.recruitFboNumero})`,
        ...(() => {
          const content = {
            greeting: `Bonjour ${s.sponsorNom},`,
            paragraphs: [
              `Le parrainage de ${recruitName} est approuvé. Sa fiche d'agrément cachetée est en pièce jointe.`,
              `L'achat de parrainage est préfacturé. ${finalNote}`,
            ],
            rows,
            cta,
          };
          return { html: emailHtml(content), body: emailText(content) };
        })(),
        attachments,
        metadata: { type: "SPONSORSHIP_APPROVED", sponsorshipId: s.id, recipient: "SPONSOR" },
      },
      "sponsor-approved",
    ),
  ]);

  await addSponsorshipLog(null, {
    sponsorshipId: s.id,
    action: "APPROVAL_NOTIFIED",
    note: `Notification d'approbation (commande ${order.preorderNumber}) : ${results.filter((r) => r.ok).length} envoi(s) réussi(s).`,
    meta: { results, paymentLink: paymentLink || null },
  }).catch(() => {});
  return results;
}

// Parrainage validé (achat payé) : confirmation aux deux.
async function notifySponsorshipValidated({ sponsorshipId, preorderNumber }) {
  const s = await prisma.sponsorship.findUnique({ where: { id: sponsorshipId } });
  if (!s) return [];
  const { countryCode } = await countryInfo(s.countryId);
  const recruitName = `${s.firstNames} ${s.lastName}`;
  const rows = [["N° FBO du filleul", s.recruitFboNumero], ["Commande payée", preorderNumber || ""]];

  const content = (greeting, paragraph) => ({ greeting, paragraphs: [paragraph], rows });
  const recruitContent = content(`Bonjour ${recruitName},`, `Votre premier achat est payé : votre parrainage est validé. Bienvenue chez Forever !`);
  const sponsorContent = content(`Bonjour ${s.sponsorNom},`, `L'achat de ${recruitName} est payé : le parrainage est validé et ${s.firstNames} est désormais rattaché(e) à votre équipe. Merci !`);

  return Promise.all([
    safeSms({ to: s.mobile, countryCode, message: `FOREVER: votre achat est paye, votre parrainage est valide (FBO ${s.recruitFboNumero}). Bienvenue !` }),
    safeSms({
      to: s.sponsorPhone || (await findSponsorPhone(s)),
      countryCode,
      message: fitSms([`FOREVER: parrainage de ${recruitName} valide (FBO ${s.recruitFboNumero}). Merci !`, `FOREVER: parrainage valide (FBO ${s.recruitFboNumero}). Merci !`]),
    }),
    safeEmail(
      { to: s.email, subject: "Votre parrainage Forever est validé", html: emailHtml(recruitContent), body: emailText(recruitContent), metadata: { type: "SPONSORSHIP_VALIDATED", sponsorshipId: s.id, recipient: "RECRUIT" } },
      "recruit-validated",
    ),
    safeEmail(
      { to: s.sponsorEmail, subject: `Parrainage validé : ${recruitName}`, html: emailHtml(sponsorContent), body: emailText(sponsorContent), metadata: { type: "SPONSORSHIP_VALIDATED", sponsorshipId: s.id, recipient: "SPONSOR" } },
      "sponsor-validated",
    ),
  ]);
}

module.exports = { notifySponsorshipApproved, notifySponsorshipValidated };
