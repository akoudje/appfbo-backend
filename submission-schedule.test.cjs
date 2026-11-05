const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeSubmissionWindow,
  canSubmitNow,
  serializeWindow,
  validateSchedule,
  normalizeSchedule,
  buildOverride,
} = require("./src/services/submission-schedule.service");

// Pause de traitement lundi–vendredi 15:00–18:30, samedi fermé jusqu'à
// 17:00, dimanche fermé toute la journée.
const weekday = [{ start: "15:00", end: "18:30" }];
const pauses = {
  version: 2,
  days: {
    0: [{ start: "00:00", end: "24:00" }],
    1: weekday,
    2: weekday,
    3: weekday,
    4: weekday,
    5: weekday,
    6: [{ start: "00:00", end: "17:00" }],
  },
};
const settings = (extra = {}) => ({
  preorderSubmissionEnabled: true,
  submissionScheduleEnabled: true,
  submissionSchedule: pauses,
  submissionGraceMinutes: 15,
  ...extra,
});
const at = (iso) => new Date(iso);
// 2026-11-03 est un mardi ; la Côte d'Ivoire est à UTC+0.
const window = (iso, extra, country = "CIV") =>
  computeSubmissionWindow({ settings: settings(extra), countryCode: country, now: at(iso) });
const message = (iso, extra) => serializeWindow(window(iso, extra), settings(extra), at(iso)).message;

test("sans horaire activé, les soumissions restent ouvertes", () => {
  const w = window("2026-11-03T16:00:00Z", { submissionScheduleEnabled: false });
  assert.equal(w.open, true);
  assert.equal(w.closesAt, null);
});

test("ouvert le matin, avec l'heure de la prochaine pause", () => {
  const w = window("2026-11-03T10:00:00Z");
  assert.equal(w.open, true);
  assert.equal(w.closesAt.toISOString(), "2026-11-03T15:00:00.000Z");
});

test("pause de 15:00 : tolérance de 15 min, réouverture à 18:30 au plus tard", () => {
  const now = at("2026-11-03T15:10:00Z");
  const w = window(now.toISOString());
  assert.equal(w.open, false);
  assert.equal(w.reason, "SCHEDULE");
  assert.equal(w.closedSince.toISOString(), "2026-11-03T15:00:00.000Z");
  assert.equal(w.graceUntil.toISOString(), "2026-11-03T15:15:00.000Z");
  assert.equal(w.opensAt.toISOString(), "2026-11-03T18:30:00.000Z");
  assert.equal(canSubmitNow(w, { draftCreatedAt: "2026-11-03T14:50:00Z", now }), true);
  assert.equal(canSubmitNow(w, { draftCreatedAt: "2026-11-03T15:02:00Z", now }), false);
  assert.match(message("2026-11-03T15:10:00Z"), /Réouverture prévue aujourd’hui à 18h30 au plus tard\./);
});

test("ouvert le soir et toute la nuit jusqu'à la pause du lendemain", () => {
  const w = window("2026-11-03T23:00:00Z");
  assert.equal(w.open, true);
  assert.equal(w.closesAt.toISOString(), "2026-11-04T15:00:00.000Z");
  assert.equal(window("2026-11-04T03:00:00Z").open, true);
});

test("samedi fermé jusqu'à 17:00, dimanche fermé, réouverture lundi à minuit", () => {
  assert.equal(window("2026-11-06T20:00:00Z").closesAt.toISOString(), "2026-11-07T00:00:00.000Z");
  const saturday = window("2026-11-07T10:00:00Z");
  assert.equal(saturday.open, false);
  assert.equal(saturday.opensAt.toISOString(), "2026-11-07T17:00:00.000Z");
  assert.equal(window("2026-11-07T18:00:00Z").closesAt.toISOString(), "2026-11-08T00:00:00.000Z");
  const sunday = window("2026-11-08T10:00:00Z");
  assert.equal(sunday.open, false);
  assert.equal(sunday.opensAt.toISOString(), "2026-11-09T00:00:00.000Z");
  assert.match(message("2026-11-08T10:00:00Z"), /demain à 00h00 au plus tard/);
});

test("heure locale du pays : au Niger (UTC+1), la pause commence à 14:00 UTC", () => {
  assert.equal(window("2026-11-03T13:59:00Z", {}, "NER").open, true);
  const w = window("2026-11-03T14:01:00Z", {}, "NER");
  assert.equal(w.open, false);
  assert.equal(w.closedSince.toISOString(), "2026-11-03T14:00:00.000Z");
});

test("« Rouvrir maintenant » pendant la pause : ouvert jusqu'à la pause suivante", () => {
  const override = { mode: "OPEN", until: "2026-11-03T18:30:00.000Z", at: "2026-11-03T16:00:00.000Z" };
  const w = window("2026-11-03T16:05:00Z", { submissionOverride: override });
  assert.equal(w.open, true);
  assert.equal(w.closesAt.toISOString(), "2026-11-04T15:00:00.000Z");
});

test("ouverture prolongée jusqu'à 15:30, puis pause avec tolérance depuis 15:30", () => {
  const override = { mode: "OPEN", until: "2026-11-03T15:30:00.000Z", at: "2026-11-03T14:00:00.000Z" };
  const during = window("2026-11-03T15:10:00Z", { submissionOverride: override });
  assert.equal(during.open, true);
  assert.equal(during.closesAt.toISOString(), "2026-11-03T15:30:00.000Z");
  const after = window("2026-11-03T15:35:00Z", { submissionOverride: override });
  assert.equal(after.open, false);
  assert.equal(after.closedSince.toISOString(), "2026-11-03T15:30:00.000Z");
  assert.equal(after.graceUntil.toISOString(), "2026-11-03T15:45:00.000Z");
  assert.equal(after.opensAt.toISOString(), "2026-11-03T18:30:00.000Z");
});

test("pause prolongée jusqu'à 19:00 : fermé sans tolérance, puis ouvert", () => {
  const override = { mode: "CLOSED", until: "2026-11-03T19:00:00.000Z", at: "2026-11-03T18:00:00.000Z" };
  const now = at("2026-11-03T18:40:00Z");
  const w = window(now.toISOString(), { submissionOverride: override });
  assert.equal(w.open, false);
  assert.equal(w.reason, "OVERRIDE_CLOSED");
  assert.equal(w.opensAt.toISOString(), "2026-11-03T19:00:00.000Z");
  assert.equal(canSubmitNow(w, { draftCreatedAt: "2026-11-03T14:00:00Z", now }), false);
  assert.equal(window("2026-11-03T19:05:00Z", { submissionOverride: override }).open, true);
});

test("« Fermer maintenant » le matin jusqu'à 12:00, réouverture à midi", () => {
  const override = { mode: "CLOSED", until: "2026-11-03T12:00:00.000Z", at: "2026-11-03T10:00:00.000Z" };
  const w = window("2026-11-03T10:30:00Z", { submissionOverride: override });
  assert.equal(w.open, false);
  assert.equal(w.opensAt.toISOString(), "2026-11-03T12:00:00.000Z");
  assert.equal(w.reopenIsLatest, false);
});

test("fermeture manuelle qui s'arrête dans une pause : réouverture à la fin de la pause", () => {
  const override = { mode: "CLOSED", until: "2026-11-03T16:00:00.000Z", at: "2026-11-03T14:00:00.000Z" };
  const w = window("2026-11-03T14:30:00Z", { submissionOverride: override });
  assert.equal(w.opensAt.toISOString(), "2026-11-03T18:30:00.000Z");
  assert.equal(w.reopenIsLatest, true);
});

test("exception sans horaire activé : elle s'applique puis s'arrête seule", () => {
  const override = { mode: "CLOSED", until: "2026-11-03T12:00:00.000Z", at: "2026-11-03T10:00:00.000Z" };
  const extra = { submissionScheduleEnabled: false, submissionOverride: override };
  assert.equal(window("2026-11-03T11:00:00Z", extra).open, false);
  assert.equal(window("2026-11-03T12:01:00Z", extra).open, true);
});

test("la suspension générale l'emporte, avec le message saisi", () => {
  const s = settings({ preorderSubmissionEnabled: false, preorderSubmissionDisabledMessage: "Inventaire." });
  const w = computeSubmissionWindow({ settings: s, countryCode: "CIV", now: at("2026-11-03T10:00:00Z") });
  assert.equal(w.reason, "SUSPENDED");
  assert.equal(serializeWindow(w, s).message, "Inventaire.");
});

test("ancien format (plages d'ouverture) converti en pauses", () => {
  const legacy = { 0: null, 1: { open: "07:00", close: "15:00" } };
  const schedule = normalizeSchedule(legacy);
  assert.deepEqual(schedule.days["1"], [
    { start: "00:00", end: "07:00" },
    { start: "15:00", end: "24:00" },
  ]);
  assert.deepEqual(schedule.days["0"], [{ start: "00:00", end: "24:00" }]);
  assert.deepEqual(normalizeSchedule(null).days["3"], []);
  // Ancienne exception du jour { date, mode, until: "HH:MM" }.
  const old = { date: "2026-11-03", mode: "OPEN", until: "17:00" };
  assert.equal(window("2026-11-03T16:00:00Z", { submissionOverride: old }).open, true);
});

test("validation de l'horaire", () => {
  assert.equal(validateSchedule(pauses), "");
  assert.match(validateSchedule({ 1: { open: "07:00", close: "15:00" } }), /invalide/);
  assert.match(validateSchedule({ version: 2, days: { 1: [{ start: "18:00", end: "15:00" }] } }), /précéder/);
  assert.match(validateSchedule({ version: 2, days: { 1: [{ start: "15:00", end: "18:00" }, { start: "17:00", end: "19:00" }] } }), /chevauchent/);
  assert.match(validateSchedule({ version: 2, days: { 1: [{ start: "3h", end: "18:00" }] } }), /HH:MM/);
  assert.match(validateSchedule({ version: 2, days: { 9: [] } }), /Jour inconnu/);
});

test("réglages : tolérance, et au moins un moment d'ouverture dans la semaine", () => {
  const { validateCountrySettings } = require("./src/services/country-settings-validation");
  assert.deepEqual(validateCountrySettings({ submissionScheduleEnabled: true, submissionSchedule: pauses, submissionGraceMinutes: 15 }), {});
  assert.match(validateCountrySettings({ submissionGraceMinutes: 500 }).submissionGraceMinutes, /entre 0 et 120/);
  const closed = { version: 2, days: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: "00:00", end: "24:00" }]])) };
  assert.match(validateCountrySettings({ submissionScheduleEnabled: true, submissionSchedule: closed }).submissionSchedule, /moment d’ouverture/);
});

test("construction d'une exception : heure future du jour, minuit accepté", () => {
  const now = at("2026-11-03T16:00:00Z");
  assert.equal(buildOverride({ mode: "OPEN", until: "18:30", countryCode: "CIV", now }).override.until, "2026-11-03T18:30:00.000Z");
  assert.equal(buildOverride({ mode: "CLOSED", until: "24:00", countryCode: "CIV", now }).override.until, "2026-11-04T00:00:00.000Z");
  assert.match(buildOverride({ mode: "OPEN", until: "15:00", countryCode: "CIV", now }).error, /postérieure/);
  assert.match(buildOverride({ mode: "OPEN", until: "", countryCode: "CIV", now }).error, /HH:MM/);
  assert.match(buildOverride({ mode: "X", until: "18:00", countryCode: "CIV", now }).error, /inconnue/);
  assert.equal(buildOverride({ mode: null }).override, null);
  // Niger (UTC+1) : 18:30 locale = 17:30 UTC.
  assert.equal(buildOverride({ mode: "OPEN", until: "18:30", countryCode: "NER", now }).override.until, "2026-11-03T17:30:00.000Z");
});

test("libellé de réouverture repris par le parrainage pendant une pause", () => {
  const label = (iso, extra) => serializeWindow(window(iso, extra), settings(extra), at(iso)).reopeningLabel;
  assert.equal(label("2026-11-03T10:00:00Z"), null);
  assert.equal(label("2026-11-03T15:10:00Z"), "aujourd’hui à 18h30 au plus tard");
  assert.equal(label("2026-11-03T15:10:00Z", { preorderSubmissionEnabled: false }), null);
  assert.match(label("2026-11-08T10:00:00Z"), /demain à 00h00 au plus tard/);
});
