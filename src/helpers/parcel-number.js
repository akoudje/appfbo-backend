function generateParcelNumber(preorder) {
  const baseDate = new Date();
  const y = baseDate.getFullYear();
  const m = String(baseDate.getMonth() + 1).padStart(2, "0");
  const d = String(baseDate.getDate()).padStart(2, "0");
  const shortId = String(preorder?.id || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6)
    .toUpperCase();

  return `COL-${y}${m}${d}-${shortId || "000000"}`;
}

// Même principe que generateParcelNumber, préfixe distinct (AVR = avoir) et
// basé sur l'id du PreorderBackorderCredit lui-même plutôt que celui de la
// commande d'origine : un même jour peut voir plusieurs avoirs émis pour la
// même commande, chacun a besoin de son propre numéro de colis.
function generateBackorderParcelNumber(credit) {
  const baseDate = new Date();
  const y = baseDate.getFullYear();
  const m = String(baseDate.getMonth() + 1).padStart(2, "0");
  const d = String(baseDate.getDate()).padStart(2, "0");
  const shortId = String(credit?.id || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6)
    .toUpperCase();

  return `AVR-${y}${m}${d}-${shortId || "000000"}`;
}

module.exports = {
  generateParcelNumber,
  generateBackorderParcelNumber,
};
