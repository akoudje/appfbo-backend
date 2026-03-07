// whatsapp.service.js

function buildWhatsAppMessage({ preorder, items, totals }) {
  const lines = [];

  lines.push(`- PRÉCOMMANDE FLP CI -`);
  lines.push(`Précommande N° : ${preorder.id}`);
  lines.push(`FBO: ${preorder.fboNumero}`);
  lines.push(`Nom: ${preorder.fboNomComplet}`);
  lines.push(`Mode de livraison: ${preorder.deliveryMode}`);
  lines.push(`Mode de Paiement: ${preorder.paymentMode}`);
  lines.push(``);

  lines.push(` Produits demandé :`);
  for (const it of items) {
    lines.push(`- x ${it.qty} | SKU: ${it.sku} | ${it.nom} | ${it.lineTotalFcfa} FCFA | ${it.lineTotalCc} CC`);
  }

  lines.push(``);
  lines.push(` Totaux:`);
  lines.push(`Produits: ${totals.totalProduitsFcfa} FCFA`);
  lines.push(`Livraison: ${totals.fraisLivraisonFcfa} FCFA`);
  lines.push(`GLOBAL: ${totals.totalFcfa} FCFA`);

  return lines.join("\n");
}

function buildWhatsAppLink(phone, message) {
  const clean = String(phone).replace(/[^\d]/g, "");
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${clean}?text=${encoded}`;
}



function buildPaymentWhatsAppMessage({
  fboNomComplet,
  fboNumero,
  factureReference,
  totalFcfa,
  paymentLink,
  paymentMode,
}) {
  const lines = [
    `Bonjour ${fboNomComplet || "Cher FBO"},`,
    "",
    "Votre précommande FOREVER a bien été enregistrée et votre préfacture est prête."  ,
    "",
    `Référence : ${factureReference || "-"}`,
    `Numéro FBO : ${fboNumero || "-"}`,
    `Montant totalà payer : ${new Intl.NumberFormat("fr-FR").format(Number(totalFcfa || 0))} FCFA`,
  ];

  if (paymentMode === "ESPECES") {
    lines.push("");
    lines.push("Merci de vous présenter au bureau pour régler le paiement en espèces.");
  } else if (paymentLink) {
    lines.push("");
    lines.push("Veuillez finaliser votre paiement via le lien ci-dessous :");
    lines.push(paymentLink);
  }

  lines.push("Une fois le paiement confirmé, votre commande sera préparée.");

  lines.push("");
  lines.push("Merci.");
  lines.push("FOREVER");

  return lines.join("\n");
}
module.exports = {
  buildWhatsAppMessage,
  buildWhatsAppLink,
  buildPaymentWhatsAppMessage,
};