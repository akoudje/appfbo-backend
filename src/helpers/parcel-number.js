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

module.exports = {
  generateParcelNumber,
};
