const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeSubmissionWindow,
  canSubmitNow,
  serializeWindow,
  validateSchedule,
  normalizeSchedule,
} = require("./src/services/submission-schedule.service");

// Lundi–vendredi 07:00–15:00, samedi 08:00–11:00, dimanche fermé.
const week = {
  0: null,
  1: { open: "07:00", close: "15:00" },
  2: { open: "07:00", close: "15:00" },
  3: { open: "07:00", close: "15:00" },
  4: { open: "07:00", close: "15:00" },
  5: { open: "07:00", close: "15:00" },
  6: { open: "08:00", close: "11:00" },
};
const settings = (extra = {}) => ({
  preorderSubmissionEnabled: true,
  submissionScheduleEnabled: true,
  submissionSchedule: week,
  submissionGraceMinutes: 15,
  ...extra,
});
const at = (iso) => new Date(iso);
// 2026-10-30 est un vendredi.
const window = (iso, extra, country = "CIV") =>
  computeSubmissionWindow({ settings: settings(extra), countryCode: country, now: at(iso) });

test("sans horaire activé, les soumissions restent ouvertes", () => {
  const w = window("2026-10-30T20:00:00Z", { submissionScheduleEnabled: false });
  assert.equal(w.open, true);
  assert.equal(w.closesAt, null);
});

test("ouvert pendant la plage, avec l'heure de fermeture du jour", () => {
  const w = window("2026-10-30T10:00:00Z");
  assert.equal(w.open, true);
  assert.equal(w.closesAt.toISOString(), "2026-10-30T15:00:00.000Z");
});

test("avant l'ouverture : fermé sans tolérance, réouverture le jour même", () => {
  const w = window("2026-10-30T06:30:00Z");
  assert.equal(w.open, false);
  assert.equal(w.graceUntil, null);
  assert.equal(w.opensAt.toISOString(), "2026-10-30T07:00:00.000Z");
  assert.match(serializeWindow(w, settings(), at("2026-10-30T06:30:00Z")).message, /pas encore ouvertes\. Réouverture aujourd’hui à 07h00/);
});

test("après la fermeture : tolérance de 15 min pour un panier commencé avant", () => {
  const now = at("2026-10-30T15:10:00Z");
  const w = window(now.toISOString());
  assert.equal(w.open, false);
  assert.equal(w.closedSince.toISOString(), "2026-10-30T15:00:00.000Z");
  assert.equal(w.graceUntil.toISOString(), "2026-10-30T15:15:00.000Z");
  assert.equal(canSubmitNow(w, { draftCreatedAt: "2026-10-30T14:50:00Z", now }), true);
  assert.equal(canSubmitNow(w, { draftCreatedAt: "2026-10-30T15:02:00Z", now }), false);
  const late = at("2026-10-30T15:16:00Z");
  assert.equal(canSubmitNow(window(late.toISOString()), { draftCreatedAt: "2026-10-30T14:50:00Z", now: late }), false);
});

test("vendredi soir : réouverture le samedi, puis lundi après le samedi", () => {
  assert.equal(window("2026-10-30T18:00:00Z").opensAt.toISOString(), "2026-10-31T08:00:00.000Z");
  const saturdayEvening = window("2026-10-31T12:00:00Z");
  assert.equal(saturdayEvening.opensAt.toISOString(), "2026-11-02T07:00:00.000Z");
  assert.match(serializeWindow(saturdayEvening, settings(), at("2026-10-31T12:00:00Z")).message, /lundi 2 novembre à 07h00/);
});

test("dimanche fermé toute la journée", () => {
  const w = window("2026-11-01T10:00:00Z");
  assert.equal(w.open, false);
  assert.equal(w.graceUntil, null);
  assert.match(serializeWindow(w, settings(), at("2026-11-01T10:00:00Z")).message, /demain à 07h00/);
});

test("heure locale du pays : le Niger (UTC+1) ferme à 14:00 UTC", () => {
  assert.equal(window("2026-10-30T13:59:00Z", {}, "NER").open, true);
  const w = window("2026-10-30T14:01:00Z", {}, "NER");
  assert.equal(w.open, false);
  assert.equal(w.closedSince.toISOString(), "2026-10-30T14:00:00.000Z");
});

test("prolongation du jour jusqu'à 17:00 puis tolérance après sa fin", () => {
  const override = { date: "2026-10-30", mode: "OPEN", until: "17:00", at: "2026-10-30T14:00:00Z" };
  const during = window("2026-10-30T16:00:00Z", { submissionOverride: override });
  assert.equal(during.open, true);
  assert.equal(during.closesAt.toISOString(), "2026-10-30T17:00:00.000Z");
  const after = window("2026-10-30T17:05:00Z", { submissionOverride: override });
  assert.equal(after.open, false);
  assert.equal(after.graceUntil.toISOString(), "2026-10-30T17:15:00.000Z");
});

test("réouverture manuelle avant l'heure prévue", () => {
  const override = { date: "2026-10-30", mode: "OPEN", until: "15:00" };
  assert.equal(window("2026-10-30T06:00:00Z", { submissionOverride: override }).open, true);
});

test("fermeture manuelle : pas de tolérance, réouverture au prochain créneau", () => {
  const override = { date: "2026-10-30", mode: "CLOSED", at: "2026-10-30T10:00:00Z" };
  const now = at("2026-10-30T10:05:00Z");
  const w = window(now.toISOString(), { submissionOverride: override });
  assert.equal(w.open, false);
  assert.equal(w.reason, "OVERRIDE_CLOSED");
  assert.equal(canSubmitNow(w, { draftCreatedAt: "2026-10-30T09:00:00Z", now }), false);
  assert.equal(w.opensAt.toISOString(), "2026-10-31T08:00:00.000Z");
});

test("l'exception d'un autre jour est ignorée", () => {
  const override = { date: "2026-10-29", mode: "CLOSED" };
  assert.equal(window("2026-10-30T10:00:00Z", { submissionOverride: override }).open, true);
});

test("la suspension générale l'emporte sur l'horaire, avec le message saisi", () => {
  const s = settings({ preorderSubmissionEnabled: false, preorderSubmissionDisabledMessage: "Inventaire." });
  const w = computeSubmissionWindow({ settings: s, countryCode: "CIV", now: at("2026-10-30T10:00:00Z") });
  assert.equal(w.open, false);
  assert.equal(w.reason, "SUSPENDED");
  assert.equal(serializeWindow(w, s).message, "Inventaire.");
});

test("exception sans horaire activé : fermeture du jour sans date de réouverture", () => {
  const override = { date: "2026-10-30", mode: "CLOSED" };
  const w = window("2026-10-30T10:00:00Z", { submissionScheduleEnabled: false, submissionOverride: override });
  assert.equal(w.open, false);
  assert.equal(w.opensAt, null);
  assert.equal(window("2026-10-31T10:00:00Z", { submissionScheduleEnabled: false, submissionOverride: override }).open, true);
});

test("validation et normalisation de l'horaire", () => {
  assert.equal(validateSchedule(week), "");
  assert.match(validateSchedule({ 1: { open: "15:00", close: "07:00" } }), /précéder/);
  assert.match(validateSchedule({ 1: { open: "7h", close: "15:00" } }), /HH:MM/);
  assert.match(validateSchedule({ 8: null }), /Jour inconnu/);
  assert.deepEqual(normalizeSchedule({ 1: { open: "07:00", close: "15:00" } })["2"], null);
});

test("réglages : horaire, tolérance et au moins un jour ouvert", () => {
  const { validateCountrySettings } = require("./src/services/country-settings-validation");
  assert.deepEqual(validateCountrySettings({ submissionScheduleEnabled: true, submissionSchedule: week, submissionGraceMinutes: 15 }), {});
  assert.match(validateCountrySettings({ submissionGraceMinutes: 500 }).submissionGraceMinutes, /entre 0 et 120/);
  assert.match(validateCountrySettings({ submissionScheduleEnabled: "oui" }).submissionScheduleEnabled, /invalide/);
  assert.match(validateCountrySettings({ submissionSchedule: { 1: { open: "16:00", close: "15:00" } } }).submissionSchedule, /précéder/);
  assert.match(
    validateCountrySettings({ submissionScheduleEnabled: true }, { submissionSchedule: { 0: null } }).submissionSchedule,
    /au moins un jour/,
  );
  assert.deepEqual(validateCountrySettings({ submissionScheduleEnabled: false }, { submissionSchedule: null }), {});
});
