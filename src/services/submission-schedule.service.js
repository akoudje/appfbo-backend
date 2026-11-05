// Horaire hebdomadaire des soumissions client, par pays.
//
// Les soumissions sont ouvertes par défaut ; l'horaire décrit des PAUSES
// (ex. lundi–vendredi 15:00–18:30 pour traiter les commandes reçues,
// samedi 00:00–17:00, dimanche toute la journée). La fin d'une pause est
// l'heure de réouverture au plus tard : l'équipe peut rouvrir plus tôt.
//
// L'ouverture n'est pas un interrupteur basculé par un job : elle est
// recalculée à chaque requête à partir de l'heure locale du pays. Un serveur
// endormi ou redémarré (Render) ne peut donc pas « oublier » une fermeture.
//
// Ordre de priorité :
// 1. preorderSubmissionEnabled = false : suspension générale, sans horaire
//    de réouverture (message saisi par l'admin) ;
// 2. exception en cours (submissionOverride) : ouvert ou fermé jusqu'à un
//    instant précis (« Rouvrir maintenant », « Prolonger la pause jusqu'à… ») ;
// 3. pauses de la semaine (submissionSchedule).
//
// Tolérance : après une fermeture automatique (début de pause ou fin d'une
// ouverture exceptionnelle), un panier commencé avant la fermeture peut
// encore être envoyé pendant submissionGraceMinutes. Une fermeture manuelle
// n'en a pas.

const { timeZone } = require("./ticket-inventory.service");

const DAY_KEYS = ["0", "1", "2", "3", "4", "5", "6"]; // 0 = dimanche (Date#getDay)
const TIME_PATTERN = /^(?:([01]\d|2[0-3]):([0-5]\d)|(24):(00))$/;
const DAY_MINUTES = 24 * 60;
const MAX_PAUSES_PER_DAY = 4;
const SCHEDULE_VERSION = 2;
const DEFAULT_GRACE_MINUTES = 15;
const MAX_GRACE_MINUTES = 120;
const OVERRIDE_MODES = new Set(["OPEN", "CLOSED"]);
const SUSPENDED_MESSAGE =
  "Les soumissions de précommandes sont temporairement suspendues. Vous pouvez continuer à consulter le catalogue et votre panier.";

function zoneOf(countryCode) {
  return timeZone(String(countryCode || "").toUpperCase());
}

// « HH:MM » (00:00–24:00) -> minutes depuis minuit, sinon null.
function minutesOf(value) {
  const match = TIME_PATTERN.exec(String(value || ""));
  if (!match) return null;
  return match[3] ? DAY_MINUTES : Number(match[1]) * 60 + Number(match[2]);
}

function timeOf(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function cleanPauses(list) {
  const pauses = (Array.isArray(list) ? list : [])
    .map((pause) => ({ start: minutesOf(pause?.start), end: minutesOf(pause?.end) }))
    .filter((pause) => pause.start !== null && pause.end !== null && pause.start < pause.end)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const pause of pauses) {
    const last = merged[merged.length - 1];
    if (last && pause.start <= last.end) last.end = Math.max(last.end, pause.end);
    else merged.push({ ...pause });
  }
  return merged.map((pause) => ({ start: timeOf(pause.start), end: timeOf(pause.end) }));
}

// Format courant : { version: 2, days: { "0".."6": [{ start, end }] } }.
// Ancien format (une plage d'OUVERTURE par jour, { open, close } | null) :
// converti en pauses avant l'ouverture et après la fermeture.
function normalizeSchedule(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (source.version === SCHEDULE_VERSION) {
    const days = source.days && typeof source.days === "object" ? source.days : {};
    return { version: SCHEDULE_VERSION, days: Object.fromEntries(DAY_KEYS.map((key) => [key, cleanPauses(days[key])])) };
  }
  const legacy = Object.keys(source).some((key) => DAY_KEYS.includes(key));
  return {
    version: SCHEDULE_VERSION,
    days: Object.fromEntries(
      DAY_KEYS.map((key) => {
        if (!legacy) return [key, []];
        const day = source[key];
        const open = minutesOf(day?.open);
        const close = minutesOf(day?.close);
        if (open === null || close === null || open >= close) return [key, [{ start: "00:00", end: "24:00" }]];
        return [
          key,
          cleanPauses([
            { start: "00:00", end: timeOf(open) },
            { start: timeOf(close), end: "24:00" },
          ]),
        ];
      }),
    ),
  };
}

function validateSchedule(raw) {
  if (raw === null) return "";
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.version !== SCHEDULE_VERSION)
    return "Horaire invalide.";
  const days = raw.days;
  if (!days || typeof days !== "object" || Array.isArray(days)) return "Horaire invalide.";
  for (const key of Object.keys(days))
    if (!DAY_KEYS.includes(key)) return "Jour inconnu dans l’horaire.";
  for (const key of DAY_KEYS) {
    const pauses = days[key] ?? [];
    if (!Array.isArray(pauses)) return "Horaire invalide.";
    if (pauses.length > MAX_PAUSES_PER_DAY) return `${MAX_PAUSES_PER_DAY} pauses au plus par jour.`;
    const parsed = pauses.map((pause) => ({ start: minutesOf(pause?.start), end: minutesOf(pause?.end) }));
    if (parsed.some((pause) => pause.start === null || pause.end === null))
      return "Saisissez les heures au format HH:MM.";
    if (parsed.some((pause) => pause.start >= pause.end))
      return "Le début d’une pause doit précéder sa fin.";
    const sorted = [...parsed].sort((a, b) => a.start - b.start);
    if (sorted.some((pause, index) => index && pause.start < sorted[index - 1].end))
      return "Deux pauses du même jour se chevauchent.";
  }
  return "";
}

// Vrai si l'horaire laisse au moins un moment d'ouverture dans la semaine.
function hasOpening(schedule) {
  return DAY_KEYS.some((key) => {
    const pauses = schedule.days[key];
    return !(pauses.length === 1 && pauses[0].start === "00:00" && pauses[0].end === "24:00");
  });
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

function weekdayOf(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Instant UTC d'une heure locale « HH:MM » (24:00 = minuit suivant) à une date locale.
function localInstant(date, time, zone) {
  const minutes = minutesOf(time);
  if (minutes === DAY_MINUTES) return localInstant(addDays(date, 1), "00:00", zone);
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const seen = localParts(new Date(guess), zone);
  const [sy, sm, sd] = seen.date.split("-").map(Number);
  const offset = Date.UTC(sy, sm - 1, sd, Math.floor(seen.minutes / 60), seen.minutes % 60) - guess;
  return new Date(guess - offset);
}

// Pauses de la veille à J+8, en instants, fusionnées quand elles se touchent
// (samedi 00:00–17:00 après vendredi 24:00, dimanche entier…).
const HORIZON_DAYS = 8;
function closureIntervals(schedule, today, zone) {
  const intervals = [];
  for (let offset = -1; offset <= HORIZON_DAYS; offset++) {
    const date = addDays(today, offset);
    for (const pause of schedule.days[String(weekdayOf(date))])
      intervals.push({ start: localInstant(date, pause.start, zone), end: localInstant(date, pause.end, zone) });
  }
  intervals.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = new Date(Math.max(last.end, interval.end));
    else merged.push({ ...interval });
  }
  const horizonEnd = localInstant(addDays(today, HORIZON_DAYS + 1), "00:00", zone);
  // Une pause qui touche la fin de l'horizon n'a pas de fin connue.
  return merged.map((interval) => (interval.end >= horizonEnd ? { ...interval, end: null } : interval));
}

const containing = (intervals, instant) =>
  intervals.find((interval) => interval.start <= instant && (!interval.end || instant < interval.end));
const nextStart = (intervals, instant) => intervals.find((interval) => interval.start > instant)?.start || null;

// Exception en cours : { mode, until (ISO), at (ISO), actorLabel }.
// L'ancien format { date, mode, until: "HH:MM" } reste lu (fin du jour pour
// une fermeture sans heure).
function normalizeOverride(raw, zone) {
  if (!raw || typeof raw !== "object" || !OVERRIDE_MODES.has(raw.mode)) return null;
  let until = raw.until ? new Date(raw.until) : null;
  if (raw.date) {
    const minutes = minutesOf(raw.until);
    until = minutes !== null ? localInstant(raw.date, raw.until, zone) : localInstant(raw.date, "24:00", zone);
  }
  if (!until || !Number.isFinite(until.getTime())) return null;
  return { mode: raw.mode, until, at: raw.at ? new Date(raw.at) : null, actorLabel: raw.actorLabel || null };
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
    reopenIsLatest: false,
    closedSince: null,
    graceUntil: null,
    override: null,
    graceMinutes,
  };

  if (settings?.preorderSubmissionEnabled === false)
    return { ...base, open: false, reason: "SUSPENDED" };

  const recorded = normalizeOverride(settings?.submissionOverride, zone);
  const override = recorded && now < recorded.until && (!recorded.at || recorded.at <= now) ? recorded : null;
  if (!base.scheduled && !override) return base;

  const local = localParts(now, zone);
  const intervals = base.scheduled
    ? closureIntervals(normalizeSchedule(settings?.submissionSchedule), local.date, zone)
    : [];
  const grace = (since) => (since ? new Date(since.getTime() + graceMinutes * 60000) : null);

  if (override?.mode === "CLOSED") {
    // Après l'exception, si une pause est en cours, on rouvre à sa fin.
    const after = containing(intervals, override.until);
    return {
      ...base,
      override,
      open: false,
      reason: "OVERRIDE_CLOSED",
      closedSince: override.at,
      opensAt: after ? after.end : override.until,
      reopenIsLatest: Boolean(after),
    };
  }

  if (override?.mode === "OPEN") {
    const closesAt = containing(intervals, override.until) ? override.until : nextStart(intervals, override.until);
    return { ...base, override, closesAt };
  }

  const pause = containing(intervals, now);
  if (!pause) return { ...base, closesAt: nextStart(intervals, now) };
  // Fin d'une ouverture exceptionnelle au milieu de la pause : la fermeture
  // (et donc la tolérance) date de la fin de l'exception.
  const reopenedUntil =
    recorded?.mode === "OPEN" && recorded.until > pause.start && recorded.until <= now ? recorded.until : null;
  const closedSince = reopenedUntil || pause.start;
  return {
    ...base,
    open: false,
    reason: "SCHEDULE",
    closedSince,
    opensAt: pause.end,
    reopenIsLatest: Boolean(pause.end),
    graceUntil: grace(closedSince),
  };
}

// Un panier commencé avant la fermeture automatique reste envoyable pendant
// la tolérance ; sans date de création connue, on refuse.
function canSubmitNow(window, { draftCreatedAt, now = new Date() } = {}) {
  if (window.open) return true;
  if (!window.graceUntil || !window.closedSince || !draftCreatedAt) return false;
  return now <= window.graceUntil && new Date(draftCreatedAt) < window.closedSince;
}

// Construit l'exception demandée par l'admin : fin à « HH:MM » aujourd'hui
// (24:00 = minuit), heure du pays. Renvoie { override } ou { error }.
function buildOverride({ mode, until, countryCode, now = new Date(), actorLabel = "Administrateur" }) {
  if (mode === null) return { override: null };
  if (!OVERRIDE_MODES.has(mode)) return { error: "Action inconnue." };
  const zone = zoneOf(countryCode);
  if (minutesOf(until) === null) return { error: "Saisissez l’heure de fin au format HH:MM." };
  const end = localInstant(localParts(now, zone).date, until, zone);
  if (end <= now) return { error: "L’heure de fin doit être postérieure à l’heure actuelle." };
  return { override: { mode, until: end.toISOString(), at: now.toISOString(), actorLabel } };
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
    ? ` Réouverture prévue ${formatReopening(window.opensAt, window.timeZone, now)}${window.reopenIsLatest ? " au plus tard" : ""}.`
    : "";
  return `Les précommandes sont momentanément fermées pour le traitement des commandes reçues.${reopening} Vous pouvez continuer à consulter le catalogue et préparer votre panier.`;
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
    reopenIsLatest: window.reopenIsLatest,
    closedSince: iso(window.closedSince),
    graceUntil: window.graceUntil && now <= window.graceUntil ? iso(window.graceUntil) : null,
    graceMinutes: window.graceMinutes,
    override: window.override
      ? { mode: window.override.mode, until: iso(window.override.until), actorLabel: window.override.actorLabel }
      : null,
    message: submissionClosedMessage(window, settings, now),
    // « demain à 08h00 au plus tard » : repris tel quel par le parrainage, qui
    // reste ouvert pendant les pauses (traitement à la réouverture).
    reopeningLabel:
      !window.open && window.opensAt
        ? `${formatReopening(window.opensAt, window.timeZone, now)}${window.reopenIsLatest ? " au plus tard" : ""}`
        : null,
    serverNow: now.toISOString(),
  };
}

module.exports = {
  DEFAULT_GRACE_MINUTES,
  MAX_GRACE_MINUTES,
  SCHEDULE_VERSION,
  SUSPENDED_MESSAGE,
  zoneOf,
  minutesOf,
  normalizeSchedule,
  validateSchedule,
  hasOpening,
  localParts,
  localInstant,
  addDays,
  computeSubmissionWindow,
  canSubmitNow,
  buildOverride,
  submissionClosedMessage,
  serializeWindow,
};
