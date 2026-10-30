// Horaire hebdomadaire des soumissions client, par pays.
//
// L'ouverture n'est pas un interrupteur basculé par un job : elle est
// recalculée à chaque requête à partir de l'heure locale du pays. Un serveur
// endormi ou redémarré (Render) ne peut donc pas « oublier » une fermeture.
//
// Ordre de priorité :
// 1. preorderSubmissionEnabled = false : suspension générale, sans horaire
//    de réouverture (message saisi par l'admin) ;
// 2. exception du jour (submissionOverride) : « Fermer maintenant » ou
//    « Ouvrir jusqu'à HH:MM » (prolongation ou réouverture manuelle), valable
//    uniquement pour la date locale où elle a été posée ;
// 3. horaire de la semaine (submissionSchedule).
//
// Tolérance : après une fermeture automatique (horaire ou fin d'une
// prolongation), un panier commencé avant la fermeture peut encore être
// envoyé pendant submissionGraceMinutes. Une fermeture manuelle n'en a pas.

const { timeZone } = require("./ticket-inventory.service");

const DAY_KEYS = ["0", "1", "2", "3", "4", "5", "6"]; // 0 = dimanche (Date#getDay)
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_GRACE_MINUTES = 15;
const MAX_GRACE_MINUTES = 120;
const OVERRIDE_MODES = new Set(["OPEN", "CLOSED"]);
const SUSPENDED_MESSAGE =
  "Les soumissions de précommandes sont temporairement suspendues. Vous pouvez continuer à consulter le catalogue et votre panier.";

function zoneOf(countryCode) {
  return timeZone(String(countryCode || "").toUpperCase());
}

function minutesOf(value) {
  const match = TIME_PATTERN.exec(String(value || ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// { "0".."6": { open, close } | null } ; tout jour invalide devient fermé.
function normalizeSchedule(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(
    DAY_KEYS.map((key) => {
      const day = source[key];
      const open = minutesOf(day?.open);
      const close = minutesOf(day?.close);
      return [key, open !== null && close !== null && open < close ? { open: day.open, close: day.close } : null];
    }),
  );
}

function validateSchedule(raw) {
  if (raw === null) return "";
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "Horaire invalide.";
  for (const key of Object.keys(raw))
    if (!DAY_KEYS.includes(key)) return "Jour inconnu dans l’horaire.";
  for (const key of DAY_KEYS) {
    const day = raw[key];
    if (day === null || day === undefined) continue;
    const open = minutesOf(day.open);
    const close = minutesOf(day.close);
    if (open === null || close === null) return "Saisissez les heures au format HH:MM.";
    if (open >= close) return "L’heure d’ouverture doit précéder l’heure de fermeture.";
  }
  return "";
}

function localParts(instant, zone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function addDays(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Instant UTC d'une heure locale « HH:MM » à une date locale donnée.
function localInstant(date, time, zone) {
  const [y, m, d] = date.split("-").map(Number);
  const minutes = minutesOf(time);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const seen = localParts(new Date(guess), zone);
  const [sy, sm, sd] = seen.date.split("-").map(Number);
  const offset = Date.UTC(sy, sm - 1, sd, Math.floor(seen.minutes / 60), seen.minutes % 60) - guess;
  return new Date(guess - offset);
}

function nextOpening(schedule, today, zone, now, includeToday) {
  for (let offset = includeToday ? 0 : 1; offset <= 7; offset++) {
    const date = addDays(today, offset);
    const [y, m, d] = date.split("-").map(Number);
    const day = schedule[String(new Date(Date.UTC(y, m - 1, d)).getUTCDay())];
    if (!day) continue;
    const at = localInstant(date, day.open, zone);
    if (at > now) return at;
  }
  return null;
}

function normalizeOverride(raw, today) {
  if (!raw || typeof raw !== "object" || raw.date !== today || !OVERRIDE_MODES.has(raw.mode)) return null;
  if (raw.mode === "OPEN" && minutesOf(raw.until) === null) return null;
  return raw;
}

function computeSubmissionWindow({ settings, countryCode, now = new Date() }) {
  const zone = zoneOf(countryCode);
  const graceMinutes = Number.isInteger(settings?.submissionGraceMinutes)
    ? settings.submissionGraceMinutes
    : DEFAULT_GRACE_MINUTES;
  const base = {
    timeZone: zone,
    scheduled: Boolean(settings?.submissionScheduleEnabled),
    open: true,
    reason: null,
    closesAt: null,
    opensAt: null,
    closedSince: null,
    graceUntil: null,
    override: null,
    graceMinutes,
  };

  if (settings?.preorderSubmissionEnabled === false)
    return { ...base, open: false, reason: "SUSPENDED" };

  const local = localParts(now, zone);
  const override = normalizeOverride(settings?.submissionOverride, local.date);
  if (!base.scheduled && !override) return base;

  const schedule = normalizeSchedule(settings?.submissionSchedule);
  const day = schedule[String(local.weekday)];
  const closed = (reason, closedSince, opensAt, grace) => ({
    ...base,
    override,
    open: false,
    reason,
    closedSince,
    opensAt: base.scheduled ? opensAt : null,
    graceUntil: grace && closedSince ? new Date(closedSince.getTime() + graceMinutes * 60000) : null,
  });

  if (override?.mode === "CLOSED")
    return closed("OVERRIDE_CLOSED", override.at ? new Date(override.at) : null, nextOpening(schedule, local.date, zone, now, false), false);

  if (override?.mode === "OPEN") {
    const until = localInstant(local.date, override.until, zone);
    if (now < until) return { ...base, override, closesAt: until };
    return closed("SCHEDULE", until, nextOpening(schedule, local.date, zone, now, false), true);
  }

  if (!day) return closed("SCHEDULE", null, nextOpening(schedule, local.date, zone, now, false), false);
  const opensToday = localInstant(local.date, day.open, zone);
  const closesToday = localInstant(local.date, day.close, zone);
  if (now < opensToday) return closed("SCHEDULE", null, opensToday, false);
  if (now < closesToday) return { ...base, closesAt: closesToday };
  return closed("SCHEDULE", closesToday, nextOpening(schedule, local.date, zone, now, false), true);
}

// Un panier commencé avant la fermeture automatique reste envoyable pendant
// la tolérance ; sans date de création connue, on refuse.
function canSubmitNow(window, { draftCreatedAt, now = new Date() } = {}) {
  if (window.open) return true;
  if (!window.graceUntil || !window.closedSince || !draftCreatedAt) return false;
  return now <= window.graceUntil && new Date(draftCreatedAt) < window.closedSince;
}

function formatReopening(opensAt, zone, now) {
  const today = localParts(now, zone).date;
  const day = localParts(opensAt, zone).date;
  const time = new Intl.DateTimeFormat("fr-FR", { timeZone: zone, hour: "2-digit", minute: "2-digit" })
    .format(opensAt)
    .replace(":", "h");
  if (day === today) return `aujourd’hui à ${time}`;
  if (day === addDays(today, 1)) return `demain à ${time}`;
  const date = new Intl.DateTimeFormat("fr-FR", { timeZone: zone, weekday: "long", day: "numeric", month: "long" }).format(opensAt);
  return `${date} à ${time}`;
}

function submissionClosedMessage(window, settings, now = new Date()) {
  if (window.open) return "";
  if (window.reason === "SUSPENDED")
    return String(settings?.preorderSubmissionDisabledMessage || "").trim() || SUSPENDED_MESSAGE;
  const reopening = window.opensAt
    ? ` Réouverture ${formatReopening(window.opensAt, window.timeZone, now)}.`
    : "";
  const intro = window.closedSince || window.reason === "OVERRIDE_CLOSED"
    ? "Les précommandes sont fermées pour le moment."
    : "Les précommandes ne sont pas encore ouvertes.";
  return `${intro}${reopening} Vous pouvez continuer à consulter le catalogue et préparer votre panier.`;
}

// Forme envoyée au storefront et à l'admin (dates ISO).
function serializeWindow(window, settings, now = new Date()) {
  const iso = (value) => (value ? value.toISOString() : null);
  return {
    open: window.open,
    reason: window.reason,
    scheduled: window.scheduled,
    timeZone: window.timeZone,
    closesAt: iso(window.closesAt),
    opensAt: iso(window.opensAt),
    closedSince: iso(window.closedSince),
    graceUntil: window.graceUntil && now <= window.graceUntil ? iso(window.graceUntil) : null,
    graceMinutes: window.graceMinutes,
    override: window.override
      ? { mode: window.override.mode, until: window.override.until || null, actorLabel: window.override.actorLabel || null }
      : null,
    message: submissionClosedMessage(window, settings, now),
    serverNow: now.toISOString(),
  };
}

module.exports = {
  DEFAULT_GRACE_MINUTES,
  MAX_GRACE_MINUTES,
  SUSPENDED_MESSAGE,
  zoneOf,
  minutesOf,
  normalizeSchedule,
  validateSchedule,
  localParts,
  computeSubmissionWindow,
  canSubmitNow,
  submissionClosedMessage,
  serializeWindow,
};
