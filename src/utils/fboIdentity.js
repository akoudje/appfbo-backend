function normalizedName(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function matchingFboNames(left, right) {
  const a = normalizedName(left), b = normalizedName(right);
  if (!a || !b) return false;
  return a.replace(/ /g, "") === b.replace(/ /g, "") || a.split(" ").sort().join(" ") === b.split(" ").sort().join(" ");
}
module.exports = { matchingFboNames };
