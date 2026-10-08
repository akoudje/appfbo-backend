const ORDER_STATUSES = new Set(["DRAFT", "SUBMITTED", "INVOICED", "PAYMENT_PENDING", "PAID", "READY", "FULFILLED", "CANCELLED"]);
const PAYMENT_STATUSES = new Set(["UNPAID", "PAYMENT_PENDING", "PAID", "PARTIALLY_PAID", "REFUNDED"]);
const BILLING_STATUSES = new Set(["NONE", "QUEUED", "ASSIGNED", "IN_PROGRESS", "WAITING_CUSTOMER_DATA", "WAITING_PAYMENT", "COMPLETED", "RELEASED", "ESCALATED"]);
const PRIORITIES = new Set(["LOW", "NORMAL", "HIGH", "URGENT"]);
function queryError(message) { const error = new Error(message); error.statusCode = 400; throw error; }
function validateOrdersQuery(query = {}) {
  for (const [key, values] of [["status", ORDER_STATUSES], ["paymentStatus", PAYMENT_STATUSES], ["billingWorkStatus", BILLING_STATUSES], ["billingPriority", PRIORITIES], ["priority", PRIORITIES]]) {
    if (query[key] && !values.has(String(query[key]).trim().toUpperCase())) queryError("Filtre de commande invalide : " + key);
  }
  for (const key of ["dateFrom", "dateTo"]) {
    if (!query[key]) continue;
    const value = String(query[key]);
    const date = new Date(value + "T00:00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) queryError("La période contient une date invalide.");
  }
  if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) queryError("La date de début doit précéder la date de fin.");
  if (String(query.q || "").length > 200) queryError("La recherche est limitée à 200 caractères.");
  if (query.as400Amount !== undefined && String(query.as400Amount).trim() !== "" && (!/^\d+(?:\.\d+)?$/.test(String(query.as400Amount).trim()) || !Number.isFinite(Number(query.as400Amount)))) queryError("Le montant AS400 du filtre est invalide.");
}
function ordersSort(query = {}) {
  const fields = { createdAt: "createdAt", updatedAt: "updatedAt", total: "totalFcfa", totalFcfa: "totalFcfa", billingSlaDeadlineAt: "billingSlaDeadlineAt", billingQueueEnteredAt: "billingQueueEnteredAt", billingPriority: "billingPriority", priority: "billingPriority", assignedAt: "assignedAt", billingLastActivityAt: "billingLastActivityAt", billingEscalatedAt: "billingEscalatedAt", preparationLaunchedAt: "preparationLaunchedAt", preparedAt: "preparedAt", fulfilledAt: "fulfilledAt" };
  return [{ [fields[query.sort] || "createdAt"]: query.dir === "asc" ? "asc" : "desc" }, { id: "asc" }];
}
function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
module.exports = { validateOrdersQuery, ordersSort, csvCell };
