// src/services/sponsorship-notifications.service.js
// Notifications du parrainage, au parrain ET au filleul, par SMS et par email :
// - approbation (fusionnée avec l'achat) : n° FBO du filleul, commande
//   préfacturée, montant et lien de paiement ; l'email joint la fiche
//   d'agrément cachetée ;
// - validation : achat payé, lien parrain-filleul enregistré.
// Un échec d'envoi n'interrompt jamais le parcours (journalisé). L'admin peut
// renvoyer la notification du statut en cours (resendSponsorshipNotification).

const prisma = require("../prisma");
const { sendEmail } = require("./email.service");
const { BRAND, renderLayout, renderButton } = require("./email-templates/layout");
const { addSponsorshipLog, findSponsorPhone } = require("./sponsorship.service");
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

// Mise en page commune des emails de l'application (document HTML complet,
// bouton en tableau) : le fragment <div> nu utilisé auparavant donnait des
// boutons inertes dans certaines messageries. Le lien est aussi affiché en
// clair sous le bouton, pour le cas où le bouton ne serait pas cliquable.
function emailHtml({ greeting, paragraphs, rows = [], cta = null }) {
  const p = (text) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${BRAND.bodyText};">${escapeHtml(text)}</p>`;
  const rowsHtml = rows.length
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:8px 0 16px;width:100%;">${rows
        .map(([label, value]) => `<tr><td style="padding:6px 12px 6px 0;font-size:14px;color:${BRAND.mutedText};vertical-align:top;">${escapeHtml(label)}</td><td style="padding:6px 0;font-size:14px;font-weight:700;color:${BRAND.ink};">${escapeHtml(value)}</td></tr>`)
        .join("")}</table>`
    : "";
  const ctaHtml = cta
    ? `${renderButton({ href: cta.href, label: cta.label })}
<p style="margin:10px 0 18px;font-size:12px;line-height:1.5;color:${BRAND.mutedText};">Si le bouton ne fonctionne pas, ouvrez ce lien :<br /><a href="${escapeHtml(cta.href)}" target="_blank" rel="noopener" style="color:${BRAND.ink};word-break:break-all;">${escapeHtml(cta.href)}</a></p>`
    : "";
  return renderLayout({
    previewText: paragraphs[0] || "",
    eyebrow: "Parrainage",
    bodyHtml: `${p(greeting)}${paragraphs.map(p).join("")}${rowsHtml}${ctaHtml}`,
  });
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

// Texte SMS dans l'alphabet GSM : un seul caractère hors alphabet (espace fine
// des montants « 98 485 F », « ° », « ê », apostrophe typographique) fait passer
// tout le SMS en Unicode, limité à 70 caractères par fragment.
function gsmText(text) {
  return String(text || "")
    .replace(/[  ]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/°/g, "o")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

async function safeSms({ to, message, countryCode }) {
  if (!to) return { channel: "SMS", to: null, ok: false, skipped: true };
  try {
    const { sendSms } = require("./sms.service");
    const result = await sendSms({ to, message: gsmText(message), countryCode });
    return { channel: "SMS", to, ok: Boolean(result?.accepted), error: result?.accepted ? undefined : result?.errorMessage || result?.errorCode };
  } catch (error) {
    console.error("[sponsorship] SMS non envoyé", { to, error: error?.message || String(error) });
    return { channel: "SMS", to, ok: false, error: error?.message };
  }
}

// Envoi des messages préparés ({ who, channel, send }) : les SMS l'un après
// l'autre (deux SMS partis au même instant échouaient souvent chez Orange,
// SVC0001), les emails en parallèle. `channels` restreint les canaux (renvoi).
async function dispatch(messages, channels = null) {
  const selected = channels ? messages.filter((m) => channels.includes(m.channel)) : messages;
  const results = new Array(selected.length);
  const emails = Promise.all(
    selected.map(async (m, i) => {
      if (m.channel === "EMAIL") results[i] = { ...(await m.send()), who: m.who };
    }),
  );
  for (const [i, m] of selected.entries()) {
    if (m.channel !== "EMAIL") results[i] = { ...(await m.send()), who: m.who };
  }
  await emails;
  return results;
}

// Résumé lisible des envois pour l'historique du parrainage.
function summarizeResults(results) {
  return results
    .map((r) => `${r.channel === "SMS" ? "SMS" : "email"} ${r.who} : ${r.skipped ? "pas de destinataire" : r.ok ? "envoyé" : `échec${r.error ? ` (${r.error})` : ""}`}`)
    .join(" · ");
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

// Note d'historique : « Renvoi … par X » pour un renvoi depuis l'admin.
function logNote(label, results, resentBy) {
  return `${resentBy ? `Renvoi de la notification ${label} par ${resentBy}` : `Notification ${label}`} : ${summarizeResults(results)}.`;
}

// Approbation + achat préfacturé : un seul message, aux deux.
// order : { preorderNumber, amountToPayFcfa, paymentMode }, paymentLink : lien
// Wave / dépôt de preuve, ou null (paiement en caisse).
// channels (optionnel) : ["SMS", "EMAIL"] ; resentBy : auteur d'un renvoi.
async function notifySponsorshipApproved({ sponsorshipId, order, paymentLink, channels = null, resentBy = null, actorAdminId = null }) {
  const s = await prisma.sponsorship.findUnique({ where: { id: sponsorshipId } });
  if (!s) return [];
  const { countryCode, countryName } = await countryInfo(s.countryId);
  const recruitName = `${s.firstNames} ${s.lastName}`;
  const amount = fcfa(order.amountToPayFcfa);
  const paymentLabel = PAYMENT_LABELS[String(order.paymentMode || "").toUpperCase()] || order.paymentMode || "";
  const pay = paymentLink ? `a payer: ${paymentLink}` : "a regler en caisse.";

  const withEmail = !channels || channels.includes("EMAIL");
  const pdf = withEmail
    ? await buildSponsorshipAgreementPdfBuffer({
        sponsorship: s,
        approverName: await approverName(s.approvedById),
        countryName: countryName || "Côte d'Ivoire",
        countryCode,
      }).catch((error) => {
        console.error("[sponsorship] fiche PDF non générée", { id: s.id, error: error?.message });
        return null;
      })
    : null;
  const attachments = pdf ? [{ filename: `agrement-${s.recruitFboNumero}.pdf`, content: pdf }] : [];

  const rows = [
    ["N° FBO du filleul", s.recruitFboNumero],
    ["Commande", order.preorderNumber],
    ["Montant à payer", amount],
    ["Paiement", paymentLabel],
  ];
  const cta = paymentLink ? { label: "Payer la commande", href: paymentLink } : null;
  const finalNote = "Le parrainage sera validé dès le paiement de cette commande.";
  const sponsorPhone = s.sponsorPhone || (await findSponsorPhone(s));

  const results = await dispatch(
    [
      {
        who: "filleul",
        channel: "SMS",
        send: () =>
          safeSms({
            to: s.mobile,
            countryCode,
            message: fitSms([
              `FOREVER: bienvenue ${s.firstNames}! Votre n° FBO: ${s.recruitFboNumero}. Commande ${order.preorderNumber} ${amount} ${pay}`,
              `FOREVER: bienvenue! N° FBO ${s.recruitFboNumero}. Cde ${order.preorderNumber} ${amount} ${pay}`,
              `FOREVER: FBO ${s.recruitFboNumero}. ${amount} ${pay}`,
            ]),
          }),
      },
      {
        who: "parrain",
        channel: "SMS",
        send: () =>
          safeSms({
            to: sponsorPhone,
            countryCode,
            message: fitSms([
              `FOREVER: parrainage de ${recruitName} approuve (FBO ${s.recruitFboNumero}). Cde ${order.preorderNumber} ${amount} ${pay}`,
              `FOREVER: parrainage approuve, FBO ${s.recruitFboNumero}. Cde ${order.preorderNumber} ${amount} ${pay}`,
              `FOREVER: FBO ${s.recruitFboNumero} approuve. ${amount} ${pay}`,
            ]),
          }),
      },
      {
        who: "filleul",
        channel: "EMAIL",
        send: () => {
          const content = {
            greeting: `Bonjour ${recruitName},`,
            paragraphs: [
              `Votre inscription comme distributeur Forever, parrainée par ${s.sponsorNom}, est approuvée. Vous trouverez votre fiche d'agrément en pièce jointe.`,
              `Votre premier achat est prêt : ${finalNote.toLowerCase()}`,
            ],
            rows,
            cta,
          };
          return safeEmail(
            {
              to: s.email,
              subject: `Bienvenue chez Forever : votre n° FBO ${s.recruitFboNumero}`,
              html: emailHtml(content),
              body: emailText(content),
              attachments,
              metadata: { type: "SPONSORSHIP_APPROVED", sponsorshipId: s.id, recipient: "RECRUIT" },
            },
            "recruit-approved",
          );
        },
      },
      {
        who: "parrain",
        channel: "EMAIL",
        send: () => {
          const content = {
            greeting: `Bonjour ${s.sponsorNom},`,
            paragraphs: [
              `Le parrainage de ${recruitName} est approuvé. Sa fiche d'agrément cachetée est en pièce jointe.`,
              `L'achat de parrainage est préfacturé. ${finalNote}`,
            ],
            rows,
            cta,
          };
          return safeEmail(
            {
              to: s.sponsorEmail,
              subject: `Parrainage approuvé : ${recruitName} (FBO ${s.recruitFboNumero})`,
              html: emailHtml(content),
              body: emailText(content),
              attachments,
              metadata: { type: "SPONSORSHIP_APPROVED", sponsorshipId: s.id, recipient: "SPONSOR" },
            },
            "sponsor-approved",
          );
        },
      },
    ],
    channels,
  );

  await addSponsorshipLog(null, {
    sponsorshipId: s.id,
    action: resentBy ? "APPROVAL_NOTIFICATION_RESENT" : "APPROVAL_NOTIFIED",
    note: logNote(`d'approbation (commande ${order.preorderNumber})`, results, resentBy),
    meta: { results, paymentLink: paymentLink || null, channels },
    actorAdminId,
  }).catch(() => {});
  return results;
}

// Parrainage validé (achat payé) : confirmation aux deux.
async function notifySponsorshipValidated({ sponsorshipId, preorderNumber, channels = null, resentBy = null, actorAdminId = null }) {
  const s = await prisma.sponsorship.findUnique({ where: { id: sponsorshipId } });
  if (!s) return [];
  const { countryCode } = await countryInfo(s.countryId);
  const recruitName = `${s.firstNames} ${s.lastName}`;
  const rows = [["N° FBO du filleul", s.recruitFboNumero], ["Commande payée", preorderNumber || ""]];

  const content = (greeting, paragraph) => ({ greeting, paragraphs: [paragraph], rows });
  const recruitContent = content(`Bonjour ${recruitName},`, `Votre premier achat est payé : votre parrainage est validé. Bienvenue chez Forever !`);
  const sponsorContent = content(`Bonjour ${s.sponsorNom},`, `L'achat de ${recruitName} est payé : le parrainage est validé et ${s.firstNames} est désormais rattaché(e) à votre équipe. Merci !`);
  const sponsorPhone = s.sponsorPhone || (await findSponsorPhone(s));

  const results = await dispatch(
    [
      { who: "filleul", channel: "SMS", send: () => safeSms({ to: s.mobile, countryCode, message: `FOREVER: votre achat est paye, votre parrainage est valide (FBO ${s.recruitFboNumero}). Bienvenue !` }) },
      {
        who: "parrain",
        channel: "SMS",
        send: () =>
          safeSms({
            to: sponsorPhone,
            countryCode,
            message: fitSms([`FOREVER: parrainage de ${recruitName} valide (FBO ${s.recruitFboNumero}). Merci !`, `FOREVER: parrainage valide (FBO ${s.recruitFboNumero}). Merci !`]),
          }),
      },
      {
        who: "filleul",
        channel: "EMAIL",
        send: () =>
          safeEmail(
            { to: s.email, subject: "Votre parrainage Forever est validé", html: emailHtml(recruitContent), body: emailText(recruitContent), metadata: { type: "SPONSORSHIP_VALIDATED", sponsorshipId: s.id, recipient: "RECRUIT" } },
            "recruit-validated",
          ),
      },
      {
        who: "parrain",
        channel: "EMAIL",
        send: () =>
          safeEmail(
            { to: s.sponsorEmail, subject: `Parrainage validé : ${recruitName}`, html: emailHtml(sponsorContent), body: emailText(sponsorContent), metadata: { type: "SPONSORSHIP_VALIDATED", sponsorshipId: s.id, recipient: "SPONSOR" } },
            "sponsor-validated",
          ),
      },
    ],
    channels,
  );

  // Journalisé comme les autres notifications (absent jusqu'ici : impossible
  // de savoir si la validation avait été reçue).
  await addSponsorshipLog(null, {
    sponsorshipId: s.id,
    action: resentBy ? "VALIDATION_NOTIFICATION_RESENT" : "VALIDATION_NOTIFIED",
    note: logNote(`de validation (commande ${preorderNumber || "-"})`, results, resentBy),
    meta: { results, channels },
    actorAdminId,
  }).catch(() => {});
  return results;
}

const RESEND_CHANNELS = ["SMS", "EMAIL"];

// Renvoi depuis l'admin de la notification du statut en cours : approbation
// (n° FBO, commande à payer et lien) tant que l'achat attend, validation une
// fois l'achat payé. Le lien de paiement est recalculé depuis la commande.
async function resendSponsorshipNotification({ sponsorship: s, channels, resentBy, actorAdminId = null }) {
  const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });
  const wanted = (Array.isArray(channels) ? channels : RESEND_CHANNELS)
    .map((c) => String(c || "").trim().toUpperCase())
    .filter((c) => RESEND_CHANNELS.includes(c));
  if (!wanted.length) throw httpError(400, "Choisissez au moins un canal (SMS ou email).");

  if (s.status === "APPROVED_PENDING_PURCHASE") {
    const order = s.purchasePreorderId
      ? await prisma.preorder.findUnique({
          where: { id: s.purchasePreorderId },
          select: {
            id: true,
            preorderNumber: true,
            status: true,
            paymentStatus: true,
            totalFcfa: true,
            preorderPaymentMode: true,
            paymentProvider: true,
            paymentCollectionCode: true,
            country: { select: { code: true } },
            activePayment: { select: { amountExpectedFcfa: true } },
          },
        })
      : null;
    if (!order) throw httpError(409, "Aucune commande d'achat à rappeler : relancez l'achat du parrainage.");
    if (order.paymentStatus === "PAID") {
      throw httpError(409, `La commande ${order.preorderNumber} est payée : cliquez sur « Réévaluer » pour valider le parrainage (la notification de validation partira alors).`);
    }
    if (order.status === "CANCELLED") {
      throw httpError(409, `La commande ${order.preorderNumber} est annulée : relancez l'achat avant de renvoyer la notification.`);
    }
    const { buildPreorderActionLink } = require("../payments/payments.service");
    const { computePaymentPricing } = require("../payments/payment-pricing");
    const amountToPayFcfa =
      Number(order.activePayment?.amountExpectedFcfa || 0) ||
      computePaymentPricing({ preorderPaymentMode: order.preorderPaymentMode, paymentProvider: order.paymentProvider, orderTotalFcfa: order.totalFcfa }).amountToPayFcfa;
    const results = await notifySponsorshipApproved({
      sponsorshipId: s.id,
      order: { preorderNumber: order.preorderNumber, amountToPayFcfa, paymentMode: order.preorderPaymentMode },
      paymentLink: buildPreorderActionLink(order),
      channels: wanted,
      resentBy,
      actorAdminId,
    });
    return { kind: "APPROVAL", results };
  }

  if (s.status === "VALIDATED") {
    const qualifying = s.qualifyingPreorderId
      ? await prisma.preorder.findUnique({ where: { id: s.qualifyingPreorderId }, select: { preorderNumber: true } })
      : null;
    const results = await notifySponsorshipValidated({
      sponsorshipId: s.id,
      preorderNumber: qualifying?.preorderNumber || null,
      channels: wanted,
      resentBy,
      actorAdminId,
    });
    return { kind: "VALIDATION", results };
  }

  throw httpError(409, "Seules les notifications d'un parrainage approuvé ou validé peuvent être renvoyées.");
}

// Demande de complément ou refus : motif envoyé au filleul ET au parrain (SMS +
// email), résultat des envois journalisé. `kind` : "CHANGES_REQUESTED" | "REJECTED".
async function notifySponsorshipReview({ sponsorshipId, kind, note }) {
  const s = await prisma.sponsorship.findUnique({ where: { id: sponsorshipId } });
  if (!s) return [];
  const { countryCode } = await countryInfo(s.countryId);
  const recruitName = `${s.firstNames} ${s.lastName}`;
  const reason = String(note || "").trim();
  const changes = kind === "CHANGES_REQUESTED";
  const shortReason = reason.length > 70 ? `${reason.slice(0, 67)}...` : reason;
  // Lien de correction du filleul (complément demandé uniquement), calculé avant
  // les messages qui l'utilisent.
  const { correctionUrl, createCorrectionToken } = require("./sponsorship-correction.service");
  const link = changes ? correctionUrl(createCorrectionToken(s)) : "";

  // Le lien doit tenir en entier : motif complet s'il tient, sinon renvoi à
  // l'email (qui contient toujours le motif complet).
  const recruitSms = changes
    ? fitSms([
        `FOREVER: fiche a completer : ${reason}. Corrigez-la : ${link}`,
        `FOREVER: fiche a completer (motif par email). Corrigez-la : ${link}`,
        `FOREVER: corrigez votre fiche : ${link}`,
      ])
    : fitSms([
        `FOREVER: votre fiche de parrainage n'a pas ete acceptee. Motif : ${shortReason}`,
        "FOREVER: votre fiche de parrainage n'a pas ete acceptee. Contactez votre parrain.",
      ]);
  const sponsorSms = changes
    ? fitSms([
        `FOREVER: parrainage de ${recruitName} a completer : ${shortReason}. Votre filleul a recu un lien pour corriger.`,
        `FOREVER: parrainage a completer : ${shortReason}. Votre filleul a recu un lien pour corriger.`,
        `FOREVER: parrainage de ${recruitName} a completer. Votre filleul a recu un lien pour corriger.`,
      ])
    : fitSms([
        `FOREVER: parrainage de ${recruitName} refuse. Motif : ${shortReason}`,
        "FOREVER: un parrainage a ete refuse. Details dans Mon espace.",
      ]);

  const rows = [[changes ? "Complément demandé" : "Motif du refus", reason]];
  const recruitContent = {
    greeting: `Bonjour ${recruitName},`,
    paragraphs: changes
      ? [`Votre fiche d'inscription parrainée par ${s.sponsorNom} doit être complétée avant sa validation par Forever.`, "Corrigez-la avec le bouton ci-dessous, puis renvoyez-la. Ce lien est personnel et valable 30 jours."]
      : [`Votre fiche d'inscription parrainée par ${s.sponsorNom} n'a pas été acceptée par Forever.`, "Rapprochez-vous de votre parrain pour toute question."],
    rows,
    cta: changes ? { label: "Corriger ma fiche", href: link } : null,
  };
  const sponsorContent = {
    greeting: `Bonjour ${s.sponsorNom},`,
    paragraphs: changes
      ? [`La fiche de parrainage de ${recruitName} doit être complétée avant sa validation.`, `${s.firstNames} a reçu par SMS et par email un lien pour la corriger. Pensez à le lui rappeler s'il ne l'a pas encore fait ; vous pouvez aussi la corriger depuis « Mon espace » > « Mes parrainages ».`]
      : [`Le parrainage de ${recruitName} n'a pas été accepté par Forever.`],
    rows,
  };
  const subject = changes ? `Parrainage à compléter : ${recruitName}` : `Parrainage non accepté : ${recruitName}`;

  const sponsorPhone = s.sponsorPhone || (await findSponsorPhone(s));
  const results = await dispatch([
    { who: "filleul", channel: "SMS", send: () => safeSms({ to: s.mobile, countryCode, message: recruitSms }) },
    { who: "parrain", channel: "SMS", send: () => safeSms({ to: sponsorPhone, countryCode, message: sponsorSms }) },
    { who: "filleul", channel: "EMAIL", send: () => safeEmail({ to: s.email, subject, html: emailHtml(recruitContent), body: emailText(recruitContent), metadata: { type: `SPONSORSHIP_${kind}`, sponsorshipId: s.id, recipient: "RECRUIT" } }, `recruit-${kind}`) },
    { who: "parrain", channel: "EMAIL", send: () => safeEmail({ to: s.sponsorEmail, subject, html: emailHtml(sponsorContent), body: emailText(sponsorContent), metadata: { type: `SPONSORSHIP_${kind}`, sponsorshipId: s.id, recipient: "SPONSOR" } }, `sponsor-${kind}`) },
  ]);
  await addSponsorshipLog(null, {
    sponsorshipId: s.id,
    action: changes ? "CHANGES_REQUESTED_NOTIFIED" : "REJECTION_NOTIFIED",
    note: `Notification ${changes ? "de demande de complément" : "de refus"} : ${summarizeResults(results)}.`,
    meta: { results },
  }).catch(() => {});
  return results;
}

module.exports = { notifySponsorshipApproved, notifySponsorshipReview, notifySponsorshipValidated, resendSponsorshipNotification };
