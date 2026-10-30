const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePreorderNumbers,
  settledPreorderData,
  getSettlementEntity,
} = require("./src/services/settlement.service");

test("a pasted list yields unique preorder numbers whatever the separators", () => {
  const { numbers, unrecognized } = parsePreorderNumbers(
    "po-civ-20261029-0012, PO-CIV-20261029-0015\nPO-CIV-20261029-0012 ; merci 12345",
  );
  assert.deepEqual(numbers, ["PO-CIV-20261029-0012", "PO-CIV-20261029-0015"]);
  assert.deepEqual(unrecognized, ["merci", "12345"]);
});

test("an order settled by another subsidiary is paid with no payment deadline", () => {
  const now = new Date("2026-10-30T10:00:00Z");
  const data = settledPreorderData({ settlementReference: "COMPTA-77" }, now);
  assert.equal(data.status, "PAID");
  assert.equal(data.paymentStatus, "PAID");
  assert.equal(data.paidAt, now);
  assert.equal(data.paymentExpiresAt, null);
  assert.equal(data.billingWorkStatus, "COMPLETED");
  assert.equal(data.manualPaymentReference, "COMPTA-77");
  // Hors caisse : jamais de validation caissier.
  assert.equal("manualPaymentValidatedAt" in data, false);
});

test("only known subsidiaries are accepted", () => {
  assert.equal(getSettlementEntity("flp_burkina")?.label, "FLP Burkina Faso");
  assert.equal(getSettlementEntity("FLP_MARS"), null);
});
