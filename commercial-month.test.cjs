const test = require("node:test");
const assert = require("node:assert/strict");
const {
  commercialMonthAt,
  describeCommercialMonth,
  fromLocalInput,
  monthLabel,
  serializeClosing,
  toClosingMap,
  validateClosing,
} = require("./src/services/commercial-month.service");

// Octobre 2026 prolongé jusqu'au mardi 3 novembre 13:00 (Côte d'Ivoire, UTC+0),
// envoi conseillé avant 11:00.
const october = { month: "2026-10", closesAt: "2026-11-03T13:00:00.000Z", submitBy: "2026-11-03T11:00:00.000Z" };
const at = (iso) => new Date(iso);
const zone = "Africa/Abidjan";

test("une facture compte pour octobre jusqu'à la clôture, puis pour novembre", () => {
  const closings = toClosingMap([october]);
  assert.equal(commercialMonthAt(at("2026-10-15T10:00:00Z"), closings, zone), "2026-10");
  assert.equal(commercialMonthAt(at("2026-11-02T09:00:00Z"), closings, zone), "2026-10");
  assert.equal(commercialMonthAt(at("2026-11-03T12:59:00Z"), closings, zone), "2026-10");
  assert.equal(commercialMonthAt(at("2026-11-03T13:00:00Z"), closings, zone), "2026-11");
  assert.equal(commercialMonthAt(at("2026-11-20T10:00:00Z"), closings, zone), "2026-11");
});

test("sans clôture saisie, le mois s'arrête à minuit le dernier jour", () => {
  const closings = toClosingMap([]);
  assert.equal(commercialMonthAt(at("2026-10-31T23:59:00Z"), closings, zone), "2026-10");
  assert.equal(commercialMonthAt(at("2026-11-01T00:00:00Z"), closings, zone), "2026-11");
});

test("ce que voit le site pendant la prolongation, puis après la clôture", () => {
  const during = describeCommercialMonth([october], "CIV", at("2026-11-02T10:00:00Z"));
  assert.equal(during.month, "2026-10");
  assert.equal(during.label, "octobre 2026");
  assert.equal(during.nextLabel, "novembre 2026");
  assert.equal(during.closesAt, "2026-11-03T13:00:00.000Z");
  assert.equal(during.submitBy, "2026-11-03T11:00:00.000Z");
  assert.equal(during.calendarEnd, "2026-11-01T00:00:00.000Z");
  assert.equal(during.hasClosing, true);
  const after = describeCommercialMonth([october], "CIV", at("2026-11-03T14:00:00Z"));
  assert.equal(after.month, "2026-11");
  assert.equal(after.hasClosing, false);
  assert.equal(after.closesAt, "2026-12-01T00:00:00.000Z");
});

test("les heures saisies sont celles du pays (Niger, UTC+1)", () => {
  assert.equal(fromLocalInput("2026-11-03T13:00", "Africa/Niamey").toISOString(), "2026-11-03T12:00:00.000Z");
  assert.equal(fromLocalInput("2026-11-31T13:00", zone), null);
  assert.equal(fromLocalInput("2026-11-03 13:00", zone), null);
  const row = { id: "x", month: "2026-10", closesAt: "2026-11-03T12:00:00.000Z", submitBy: null };
  assert.equal(serializeClosing(row, "NER").closesAtLocal, "2026-11-03T13:00");
  assert.equal(serializeClosing(row, "NER").submitByLocal, "");
});

test("validation d'une clôture", () => {
  const ok = validateClosing({ month: "2026-10", closesAtLocal: "2026-11-03T13:00", submitByLocal: "2026-11-03T11:00" }, "CIV");
  assert.equal(ok.data.closesAt.toISOString(), "2026-11-03T13:00:00.000Z");
  assert.equal(ok.data.submitBy.toISOString(), "2026-11-03T11:00:00.000Z");
  assert.match(validateClosing({ month: "2026-10", closesAtLocal: "2026-10-05T13:00" }, "CIV").errors.closesAt, /seconde moitié/);
  assert.match(validateClosing({ month: "2026-10", closesAtLocal: "2026-12-02T13:00" }, "CIV").errors.closesAt, /seconde moitié/);
  assert.match(validateClosing({ month: "2026-10", closesAtLocal: "" }, "CIV").errors.closesAt, /Saisissez/);
  assert.match(
    validateClosing({ month: "2026-10", closesAtLocal: "2026-11-03T13:00", submitByLocal: "2026-11-03T14:00" }, "CIV").errors.submitBy,
    /précéder/,
  );
  assert.match(validateClosing({ month: "2026-13", closesAtLocal: "2026-11-03T13:00" }, "CIV").errors.month, /mois/);
  const previous = at("2026-10-05T10:00:00Z");
  assert.match(
    validateClosing({ month: "2026-10", closesAtLocal: "2026-10-04T13:00" }, "CIV", { previous }).errors.closesAt,
    /seconde moitié|suivre/,
  );
  const next = at("2026-11-02T10:00:00Z");
  assert.match(validateClosing({ month: "2026-10", closesAtLocal: "2026-11-03T13:00" }, "CIV", { next }).errors.closesAt, /précéder/);
});

test("libellé du mois en français", () => {
  assert.equal(monthLabel("2026-10"), "octobre 2026");
  assert.equal(monthLabel("2027-01"), "janvier 2027");
});
