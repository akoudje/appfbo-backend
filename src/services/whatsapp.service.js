function buildWhatsAppMessage({ preorder, items, totals }) {
  const lines = [];

  lines.push(`- PRÉCOMMANDE FLP CI -`);
  lines.push(`Numero: ${preorder.id}`);
  lines.push(`FBO: ${preorder.fboNumero}`);
  lines.push(`Nom: ${preorder.fboNomComplet}`);
  lines.push(`Grade: ${preorder.fboGrade}`);
  lines.push(`Livraison: ${preorder.deliveryMode}`);
  lines.push(`Paiement: ${preorder.paymentMode}`);
  lines.push(``);

  lines.push(`📦 Produits:`);
  for (const it of items) {
    lines.push(`- x${it.qty} ${it.nom} | ${it.lineTotalFcfa} FCFA | ${it.lineTotalCc} CC`);
  }

  lines.push(``);
  lines.push(`📊 Totaux:`);
  lines.push(`CC: ${totals.totalCc}`);
  lines.push(`Poids: ${totals.totalPoidsKg} Kg`);
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

module.exports = { buildWhatsAppMessage, buildWhatsAppLink };
