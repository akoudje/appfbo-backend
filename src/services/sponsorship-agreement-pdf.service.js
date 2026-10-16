// src/services/sponsorship-agreement-pdf.service.js
// Fiche « Agrément de distribution » du filleul en PDF, calquée sur la fiche
// papier FLP-CI : n° FBO saisi depuis AS400, niveau du parrain coché et cachet
// numérique « SAISIE le … par … » (équivalent du cachet du facturier).

const PDFDocument = require("pdfkit");

const LEVELS = [
  { grade: "ANIMATEUR_ADJOINT", label: "AA" },
  { grade: "ANIMATEUR", label: "A" },
  { grade: "MANAGER_ADJOINT", label: "MA" },
  { grade: "MANAGER", label: "M" },
];

const ID_DOCUMENT_SHORT = {
  CNI: "CNI",
  PASSPORT: "Passeport",
  DRIVING_LICENSE: "Permis de conduire",
  CONSULAR_CARD: "Carte consulaire",
  OTHER: "Autre pièce officielle",
};

const RED = "#b42318";
const DARK = "#111827";
const GREY = "#6b7280";

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

function formatStampDate(value) {
  return new Date(value)
    .toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    .toUpperCase();
}

// Champ façon formulaire : libellé gris + valeur dans un cadre.
function field(doc, { x, y, w, label, value, labelWidth = 92 }) {
  doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(label.toUpperCase(), x, y + 5, { width: labelWidth - 4 });
  doc.lineWidth(0.6).strokeColor("#9ca3af").rect(x + labelWidth, y, w - labelWidth, 18).stroke();
  doc
    .font("Helvetica-Bold")
    .fontSize(9.5)
    .fillColor(DARK)
    .text(String(value || ""), x + labelWidth + 5, y + 5, { width: w - labelWidth - 10, height: 12, ellipsis: true });
}

function sectionTitle(doc, text, y) {
  doc.font("Helvetica-Bold").fontSize(12).fillColor(DARK).text(text, 40, y);
  doc.moveTo(40, y + 16).lineTo(555, y + 16).lineWidth(0.8).strokeColor(DARK).stroke();
}

function drawStamp(doc, { x, y, date, agentName }) {
  doc.save();
  doc.rotate(-6, { origin: [x + 80, y + 35] });
  doc.lineWidth(1.6).strokeColor(RED).rect(x, y, 170, 66).stroke();
  doc.lineWidth(0.6).rect(x + 3, y + 3, 164, 60).stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(RED).text("FOREVER LIVING PRODUCTS-CI", x, y + 9, { width: 170, align: "center" });
  doc.font("Helvetica-Bold").fontSize(13).text(`SAISIE le ${formatStampDate(date)}`, x, y + 25, { width: 170, align: "center" });
  doc.font("Helvetica").fontSize(7.5).text(agentName ? `par ${agentName}` : "", x, y + 45, { width: 170, align: "center" });
  doc.restore();
}

// Écrit la fiche dans `stream` (réponse HTTP) ; `sponsorship` inclut les champs
// du modèle ; `approverName` = nom de l'agent qui a approuvé.
// Dessine la fiche sur la page courante de `doc`.
function drawAgreementPage(doc, { sponsorship: s, approverName, countryName = "Côte d'Ivoire" }) {

  // En-tête
  doc.font("Helvetica-Bold").fontSize(16).fillColor(DARK).text("FOREVER LIVING PRODUCTS", 40, 40);
  doc.font("Helvetica").fontSize(10).fillColor(GREY).text(countryName.toUpperCase(), 40, 60);
  doc.font("Helvetica-Bold").fontSize(15).fillColor(DARK).text("AGRÉMENT DE DISTRIBUTION - FLP-CI", 40, 92, { width: 515, align: "center" });

  // N° d'identification (case remplie par le facturier sur papier)
  doc.font("Helvetica").fontSize(9).fillColor(GREY).text("N° Identification FLP-CI", 170, 126);
  doc.lineWidth(1).strokeColor(DARK).rect(285, 120, 160, 22).stroke();
  doc.font("Helvetica-Bold").fontSize(12).fillColor(DARK).text(s.recruitFboNumero || "", 285, 126, { width: 160, align: "center" });

  // Candidat
  let y = 160;
  sectionTitle(doc, "A REMPLIR PAR LE CANDIDAT DISTRIBUTEUR", y);
  y += 28;
  const L = { x: 40, w: 255 };
  const R = { x: 300, w: 255 };
  const row = (left, right) => {
    if (left) field(doc, { ...L, y, ...left });
    if (right) field(doc, { ...R, y, ...right });
    y += 24;
  };
  row({ label: "Nom", value: s.lastName }, { label: "Prénoms", value: s.firstNames });
  row({ label: "Nom du conjoint", value: s.spouseLastName }, { label: "Prénoms conjoint", value: s.spouseFirstNames });
  row({ label: "Adresse (commune / quartier)", value: s.addressArea }, { label: "Ville", value: s.city });
  row({ label: "Boîte postale", value: s.postalBox }, { label: "Pays", value: s.homeCountry });
  row({ label: "Mobile", value: s.mobile }, { label: "Email", value: s.email });
  row({ label: "Situation de famille", value: s.maritalStatus }, { label: "Nombre d'enfants", value: s.childrenCount ?? "" });
  row({ label: "Date de naissance", value: formatDate(s.birthDate) }, { label: "Lieu de naissance", value: s.birthPlace });
  row({ label: "Pièce d'identité", value: ID_DOCUMENT_SHORT[s.idDocumentType] || "CNI" }, { label: "N° de la pièce", value: s.idDocumentNumber });
  row({ label: "Naissance conjoint", value: formatDate(s.spouseBirthDate) }, { label: "Lieu naiss. conjoint", value: s.spouseBirthPlace });
  row({ label: "N° RIB", value: s.bankRib }, null);

  // Registre de commerce
  y += 4;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(DARK).text("Si vous avez un numéro de Registre de Commerce", 40, y);
  y += 16;
  row({ label: "Profession", value: s.profession }, { label: "Secteur d'activité", value: s.businessSector });
  row({ label: "N° Registre Commerce", value: s.tradeRegisterNumber }, { label: "Date / lieu", value: [formatDate(s.tradeRegisterDate), s.tradeRegisterPlace].filter(Boolean).join(" - ") });
  const regime = (v) => (v === true ? "SOUMIS" : v === false ? "NON SOUMIS" : "");
  row({ label: "Régime de TVA", value: regime(s.vatSubject) }, { label: "Régime d'ASDI", value: regime(s.asdiSubject) });

  // Parrain
  y += 8;
  sectionTitle(doc, "A REMPLIR PAR LE PARRAIN", y);
  y += 28;
  const [sponsorLast, ...sponsorFirst] = String(s.sponsorNom || "").split(",");
  row({ label: "Nom", value: sponsorLast?.trim() }, { label: "Prénoms", value: sponsorFirst.join(",").trim() });
  field(doc, { ...L, y, label: "N° Identification FLP-CI", value: s.sponsorNumero });

  // Niveau de qualification coché (AA / A / MA / M), comme sur la fiche papier.
  doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text("NIVEAU DU PARRAIN", R.x, y + 5, { width: 88 });
  LEVELS.forEach((level, index) => {
    const bx = R.x + 92 + index * 41;
    const checked = level.grade === s.sponsorGrade;
    doc.lineWidth(0.8).strokeColor(DARK).rect(bx, y, 37, 18).stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor(checked ? RED : DARK).text(checked ? "X " + level.label : level.label, bx, y + 5, { width: 37, align: "center" });
    if (checked) doc.lineWidth(1.4).strokeColor(RED).rect(bx + 1.5, y + 1.5, 34, 15).stroke();
  });
  y += 24;
  row({ label: "Téléphone parrain", value: s.sponsorPhone }, { label: "Fait à", value: s.sponsorCity });

  // Mentions de la fiche papier
  y += 6;
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(DARK)
    .text(
      `Je soussigné, candidat distributeur, m'engage à respecter les conditions énoncées et atteste, moi et/ou mon conjoint, n'avoir jamais signé de contrat Distributeur Forever dans les 24 derniers mois (2 ans). En cas de non-respect de l'une quelconque des conditions indiquées ou si les renseignements indiqués s'avèrent inexacts, FOREVER LIVING PRODUCTS ${countryName} pourra résilier de plein droit le présent contrat sans préjudice de toutes poursuites par les administrations compétentes. Cette résiliation prendra effet cinq jours après la notification envoyée par lettre recommandée avec accusé de réception.`,
      40,
      y,
      { width: 515, align: "justify" },
    );
  y = doc.y + 10;

  // Signatures remplacées par l'attestation électronique + cachet
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(DARK).text("Fiche remplie en ligne par le parrain", 40, y);
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(GREY)
    .text(
      `Attestation d'accord et de procuration du candidat acceptée le ${formatDate(s.consentAcceptedAt)} par ${s.sponsorNom} (${s.sponsorNumero}). Pièce d'identité du candidat jointe au dossier numérique.`,
      40,
      y + 13,
      { width: 300 },
    );
  if (s.approvedAt) drawStamp(doc, { x: 380, y: y - 4, date: s.approvedAt, agentName: approverName });

  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(GREY)
    .text(`Document généré par l'application FBO le ${formatDate(new Date())} · Réf. dossier ${s.id}`, 40, 790, { width: 515, align: "center", lineBreak: false });

}

function newDocument(s) {
  return new PDFDocument({ size: "A4", margin: 40, info: { Title: `Agrément de distribution - ${s.lastName} ${s.firstNames}` } });
}

// Fiche seule, écrite dans `stream` (réponse HTTP).
function writeSponsorshipAgreementPdf(stream, options) {
  const doc = newDocument(options.sponsorship);
  doc.pipe(stream);
  drawAgreementPage(doc, options);
  doc.end();
  return doc;
}

// Fiche d'agrément cachetée en mémoire (Buffer), pour une pièce jointe d'email.
function buildSponsorshipAgreementPdfBuffer(options) {
  return new Promise((resolve, reject) => {
    const doc = newDocument(options.sponsorship);
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    drawAgreementPage(doc, options);
    doc.end();
  });
}

const fcfa = (value) => `${new Intl.NumberFormat("fr-FR").format(Math.round(Number(value) || 0)).replace(/\u202f|\u00a0/g, " ")} F`;

const PAYMENT_LABELS = {
  WAVE: "Wave",
  BANK_TRANSFER: "Virement bancaire",
  ECOBANK_PAY: "Ecobank Pay",
  PI_SPI: "PI SPI",
  ESPECES: "Espèces",
  ORANGE_MONEY: "Orange Money",
};
const DELIVERY_LABELS = { RETRAIT_SITE_FLP: "Retrait au siège", LIVRAISON: "Livraison" };
const ORDER_STATUS_LABELS = {
  DRAFT: "Brouillon",
  SUBMITTED: "Soumise",
  INVOICED: "Préfacturée",
  PAID: "Payée",
  READY: "Prête",
  FULFILLED: "Servie",
  CANCELLED: "Annulée",
};
const PAYMENT_STATUS_LABELS = { UNPAID: "Non payée", PAID: "Payée", PARTIAL: "Partiellement payée", REFUNDED: "Remboursée" };

// Tableau produits : [{ sku, nom, qty, unitFcfa, totalFcfa }] ; renvoie le y final.
function drawLinesTable(doc, lines, y) {
  const cols = [
    { label: "Réf.", x: 40, w: 55 },
    { label: "Produit", x: 95, w: 245 },
    { label: "Qté", x: 340, w: 40, align: "right" },
    { label: "Prix unit.", x: 385, w: 80, align: "right" },
    { label: "Total", x: 470, w: 85, align: "right" },
  ];
  doc.font("Helvetica-Bold").fontSize(8).fillColor(GREY);
  cols.forEach((c) => doc.text(c.label.toUpperCase(), c.x, y, { width: c.w, align: c.align || "left" }));
  y += 14;
  doc.moveTo(40, y - 3).lineTo(555, y - 3).lineWidth(0.5).strokeColor("#d1d5db").stroke();
  doc.font("Helvetica").fontSize(9).fillColor(DARK);
  for (const line of lines) {
    if (y > 760) {
      doc.addPage();
      y = 40;
    }
    const values = [line.sku || "", line.nom || "", String(line.qty ?? ""), line.unitFcfa != null ? fcfa(line.unitFcfa) : "", fcfa(line.totalFcfa)];
    cols.forEach((c, i) => doc.text(values[i], c.x, y, { width: c.w, align: c.align || "left", height: 12, ellipsis: true }));
    y += 15;
  }
  return y;
}

// Page « Achat de parrainage » du dossier : panier du parrain, paiement choisi
// et commande réelle (préfacture, montant AS400, paiement). `purchase` :
// { order, orderLines, qualifyingOrder } (peut être vide).
function drawPurchasePage(doc, { sponsorship: s, purchase = {} }) {
  doc.addPage();
  doc.font("Helvetica-Bold").fontSize(15).fillColor(DARK).text("Achat de parrainage", 40, 40);
  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor(GREY)
    .text(`${s.lastName} ${s.firstNames}${s.recruitFboNumero ? ` · FBO ${s.recruitFboNumero}` : ""} · parrain ${s.sponsorNom} (${s.sponsorNumero}) · dossier ${s.id}`, 40, 60);

  let y = 85;
  field(doc, { x: 40, y, w: 255, label: "Achat minimum", value: s.minPurchaseFcfa != null ? fcfa(s.minPurchaseFcfa) : "Fixé à l'approbation" });
  field(doc, { x: 300, y, w: 255, label: "Paiement choisi", value: PAYMENT_LABELS[s.purchasePaymentMode] || s.purchasePaymentMode || "—" });
  y += 24;
  field(doc, { x: 40, y, w: 255, label: "Livraison", value: DELIVERY_LABELS[s.purchaseDeliveryMode] || s.purchaseDeliveryMode || "—" });
  field(doc, { x: 300, y, w: 255, label: "Parrainage validé", value: s.validatedAt ? `le ${formatDate(s.validatedAt)}` : "Non (en attente de paiement)" });
  y += 36;

  // 1) Panier composé par le parrain à la soumission.
  sectionTitle(doc, "Panier du parrain (prix Client privilégié indicatifs)", y);
  y += 26;
  const cart = Array.isArray(s.purchaseItems) ? s.purchaseItems : [];
  if (cart.length) {
    y = drawLinesTable(
      doc,
      cart.map((l) => ({ sku: l.sku, nom: l.nom, qty: l.qty, unitFcfa: l.prixFcfa, totalFcfa: l.lineTotalFcfa })),
      y,
    );
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(DARK).text(`Total indicatif : ${fcfa(s.purchaseIndicativeTotalFcfa)}`, 340, y + 4, { width: 215, align: "right" });
    y += 26;
  } else {
    doc.font("Helvetica").fontSize(9.5).fillColor(GREY).text("Aucun panier enregistré.", 40, y);
    y += 22;
  }

  // 2) Commande réelle (préfacturée à l'approbation ou relancée).
  if (y > 640) {
    doc.addPage();
    y = 40;
  }
  sectionTitle(doc, "Commande d'achat", y);
  y += 26;
  const order = purchase.order;
  if (!order) {
    doc.font("Helvetica").fontSize(9.5).fillColor(GREY).text("Aucune commande d'achat créée pour l'instant.", 40, y);
    return;
  }
  field(doc, { x: 40, y, w: 255, label: "N° de commande", value: order.preorderNumber });
  field(doc, { x: 300, y, w: 255, label: "Statut", value: ORDER_STATUS_LABELS[order.status] || order.status });
  y += 24;
  field(doc, { x: 40, y, w: 255, label: "Réf. AS400", value: order.factureReference || "—" });
  field(doc, { x: 300, y, w: 255, label: "Montant AS400", value: order.as400InvoiceTotalFcfa != null ? fcfa(order.as400InvoiceTotalFcfa) : "—" });
  y += 24;
  field(doc, { x: 40, y, w: 255, label: "Paiement", value: PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus });
  field(doc, { x: 300, y, w: 255, label: "Payée le", value: order.paidAt ? formatDate(order.paidAt) : "—" });
  y += 30;
  const lines = purchase.orderLines || [];
  if (lines.length) {
    y = drawLinesTable(doc, lines, y);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(DARK).text(`Total commande : ${fcfa(order.totalFcfa)}`, 340, y + 4, { width: 215, align: "right" });
    y += 26;
  }
  const qualifying = purchase.qualifyingOrder;
  if (qualifying && qualifying.id !== order.id) {
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(DARK)
      .text(`Parrainage validé par la commande ${qualifying.preorderNumber} (réf. AS400 ${qualifying.factureReference || "—"}, ${fcfa(qualifying.as400InvoiceTotalFcfa ?? qualifying.totalFcfa)}).`, 40, y + 4, { width: 515 });
  }
}

const DOCUMENT_PAGE_LABELS = {
  ID_FRONT: "recto",
  ID_BACK: "verso",
  PASSPORT: "page d'identité",
  OTHER: "autre pièce",
};

// Dossier de traitement : fiche + achat de parrainage + une page par image de
// la pièce d'identité, puis les pièces envoyées en PDF ajoutées telles quelles.
// `documents` : [{ type, mimeType, originalFileName, buffer }] ; `purchase` :
// voir drawPurchasePage. Renvoie un Buffer PDF.
async function buildSponsorshipDossierPdf({ sponsorship: s, approverName, countryName, documents = [], purchase = {} }) {
  const doc = newDocument(s);
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  drawAgreementPage(doc, { sponsorship: s, approverName, countryName });
  drawPurchasePage(doc, { sponsorship: s, purchase });

  const pieceLabel = ID_DOCUMENT_SHORT[s.idDocumentType] || "Pièce";
  const pdfAttachments = [];
  for (const document of documents) {
    const title = `Pièce d'identité — ${pieceLabel} (${DOCUMENT_PAGE_LABELS[document.type] || "pièce"})`;
    if (document.mimeType === "application/pdf") {
      pdfAttachments.push({ title, buffer: document.buffer });
      continue;
    }
    doc.addPage();
    doc.font("Helvetica-Bold").fontSize(13).fillColor(DARK).text(title, 40, 40);
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor(GREY)
      .text(`${s.lastName} ${s.firstNames} · ${pieceLabel} n° ${s.idDocumentNumber} · dossier ${s.id}`, 40, 60);
    try {
      doc.image(document.buffer, 40, 85, { fit: [515, 700], align: "center", valign: "top" });
    } catch {
      doc.font("Helvetica").fontSize(10).fillColor(RED).text("Image illisible : consultez la pièce dans l'application.", 40, 100);
    }
  }
  if (pdfAttachments.length) {
    doc.addPage();
    doc.font("Helvetica-Bold").fontSize(13).fillColor(DARK).text("Pièces jointes au format PDF", 40, 40);
    doc.font("Helvetica").fontSize(10).fillColor(GREY).text(pdfAttachments.map((a) => `• ${a.title}`).join("\n"), 40, 65);
  }
  doc.end();
  await finished;
  const mainPdf = Buffer.concat(chunks);
  if (!pdfAttachments.length) return mainPdf;

  // Ajout des pièces PDF à la suite (pdf-lib).
  const { PDFDocument: PdfLibDocument } = require("pdf-lib");
  const merged = await PdfLibDocument.load(mainPdf);
  for (const attachment of pdfAttachments) {
    try {
      const source = await PdfLibDocument.load(attachment.buffer, { ignoreEncryption: true });
      const pages = await merged.copyPages(source, source.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
    } catch {
      // PDF illisible : la page récapitulative l'indique déjà ; on continue.
    }
  }
  return Buffer.from(await merged.save());
}

module.exports = { writeSponsorshipAgreementPdf, buildSponsorshipAgreementPdfBuffer, buildSponsorshipDossierPdf };
