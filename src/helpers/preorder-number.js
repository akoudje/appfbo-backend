// src/helpers/preorder-number.js
// cette fonction génère un numéro de précommande unique basé sur le code pays, la date et une séquence
// Le format est : PO-{COUNTRY_CODE}-{DATE_KEY}-{SEQ}


function formatDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatPreorderNumber({ countryCode, dateKey, seq }) {
  const safeCountryCode = String(countryCode || "CIV")
    .trim()
    .toUpperCase();

  const paddedSeq = String(seq || 0).padStart(4, "0");

  return `PO-${safeCountryCode}-${dateKey}-${paddedSeq}`;
}

module.exports = {
  formatDateKey,
  formatPreorderNumber,
};