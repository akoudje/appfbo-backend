// src/services/whatsapp.service.js

/**
 * Formate un montant FCFA
 */
function formatFcfa(value) {
  return `${new Intl.NumberFormat("fr-FR").format(Number(value || 0))} FCFA`;
}

/**
 * Nettoie un numéro de téléphone pour wa.me ou provider
 */
function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

/**
 * Construit un message récapitulatif complet de précommande
 * Usage: génération manuelle / audit / support
 */
function buildPreorderWhatsAppMessage({ preorder, items = [], totals = {} }) {
  const lines = [];

  lines.push(`- PRÉCOMMANDE FLP CIV -`);
  lines.push(`Précommande N° : ${preorder?.id || "-"}`);
  lines.push(`FBO : ${preorder?.fboNumero || "-"}`);
  lines.push(`Nom : ${preorder?.fboNomComplet || "-"}`);
  lines.push(`Mode de livraison : ${preorder?.deliveryMode || "-"}`);
  lines.push(`Mode de paiement : ${preorder?.paymentMode || "-"}`);
  lines.push("");

  lines.push(`Produits demandés :`);
  for (const it of items) {
    lines.push(
      `- x ${it.qty || 0} | SKU: ${it.sku || it.productSkuSnapshot || "-"} | ${it.nom || it.productNameSnapshot || "-"} | ${formatFcfa(it.lineTotalFcfa)} | ${it.lineTotalCc || 0} CC`
    );
  }

  lines.push("");
  lines.push(`Totaux :`);
  lines.push(`Produits : ${formatFcfa(totals.totalProduitsFcfa)}`);
  lines.push(`Livraison : ${formatFcfa(totals.fraisLivraisonFcfa)}`);
  lines.push(`GLOBAL : ${formatFcfa(totals.totalFcfa)}`);

  return lines.join("\n");
}

/**
 * Alias rétrocompatible
 * Permet à l'ancien code d'utiliser encore buildWhatsAppMessage
 */
function buildWhatsAppMessage(args) {
  return buildPreorderWhatsAppMessage(args);
}

/**
 * Construit un lien wa.me pour envoi manuel depuis WhatsApp
 */
function buildWhatsAppLink(phone, message) {
  const clean = normalizePhone(phone);
  const encoded = encodeURIComponent(message || "");
  return `https://wa.me/${clean}?text=${encoded}`;
}

/**
 * Message de facturation / paiement envoyé au FBO
 * Harmonisé avec le workflow invoiceAndSendPreorder
 */
function buildPaymentWhatsAppMessage({
  fboNomComplet,
  fboNumero,
  factureReference,
  totalFcfa,
  paymentLink,
  paymentMode,
  note,
}) {
  const lines = [
    `Bonjour ${fboNomComplet || "Cher FBO"},`,
    "",
    "Votre précommande FOREVER a bien été enregistrée et votre préfacture est prête.",
    "",
    `Référence : ${factureReference || "-"}`,
    `Numéro FBO : ${fboNumero || "-"}`,
    `Montant à payer : ${formatFcfa(totalFcfa)}`,
  ];

  if (paymentMode === "ESPECES") {
    lines.push("");
    lines.push(
      "Merci de vous présenter au bureau pour effectuer le règlement en espèces."
    );
    lines.push("Votre commande sera préparée après validation du paiement.");
  } else if (paymentLink) {
    lines.push("");
    lines.push(
      "Veuillez finaliser votre paiement en cliquant sur le lien ci-dessous :"
    );
    lines.push(paymentLink);
    lines.push("");
    lines.push("Une fois le paiement confirmé, votre commande sera préparée.");
  } else {
    lines.push("");
    lines.push(
      "Merci de procéder au règlement selon les instructions communiquées."
    );
  }

  if (note) {
    lines.push("");
    lines.push(String(note));
  }

  lines.push("");
  lines.push("Merci.");
  lines.push("FOREVER");

  return lines.join("\n");
}

/**
 * Alias plus explicite pour le workflow de facturation
 */
function buildInvoiceWhatsAppMessage({
  customerName,
  fboNumero,
  invoiceRef,
  totalFcfa,
  paymentLink,
  paymentMode,
  note,
}) {
  return buildPaymentWhatsAppMessage({
    fboNomComplet: customerName,
    fboNumero,
    factureReference: invoiceRef,
    totalFcfa,
    paymentLink,
    paymentMode,
    note,
  });
}

/**
 * Envoi texte WhatsApp
 * Pour l’instant: mode simulé
 * Plus tard: remplacer par Meta Cloud API / Twilio / autre provider
 */
async function sendTextMessage({ to, body, metadata = {} }) {
  const normalizedTo = normalizePhone(to);

  if (!normalizedTo) {
    return {
      accepted: false,
      provider: "SIMULATED",
      providerMessageId: null,
      rawPayload: {
        ok: false,
        reason: "NO_DESTINATION",
        metadata,
      },
      errorCode: "NO_DESTINATION",
      errorMessage: "Numéro WhatsApp manquant ou invalide.",
    };
  }

  console.log("[whatsapp.sendTextMessage]", {
    to: normalizedTo,
    body,
    metadata,
  });

  return {
    accepted: true,
    provider: "SIMULATED",
    providerMessageId: `sim_${Date.now()}`,
    rawPayload: {
      ok: true,
      simulated: true,
      to: normalizedTo,
      metadata,
    },
  };
}

/**
 * Mappe un statut provider vers ton statut interne Prisma
 */
function mapProviderStatus(input) {
  const s = String(input || "").toLowerCase();

  if (s === "draft") return "DRAFT";
  if (s === "queued") return "QUEUED";
  if (s === "sent") return "SENT";
  if (s === "delivered") return "DELIVERED";
  if (s === "read") return "READ";
  if (s === "failed") return "FAILED";
  if (s === "cancelled" || s === "canceled") return "CANCELLED";

  return "SENT";
}

module.exports = {
  formatFcfa,
  normalizePhone,
  buildPreorderWhatsAppMessage,
  buildWhatsAppMessage,
  buildWhatsAppLink,
  buildPaymentWhatsAppMessage,
  buildInvoiceWhatsAppMessage,
  sendTextMessage,
  mapProviderStatus,
};
