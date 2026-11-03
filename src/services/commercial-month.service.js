// Mois commercial : les achats d'un mois peuvent être prolongés au-delà du
// mois calendaire (ex. octobre 2026 jusqu'au mardi 3 novembre 13:00).
//
// C'est la FACTURATION qui fait foi : une précommande facturée avant la
// clôture compte pour le mois clôturé. L'admin saisit la clôture mois par
// mois (CommercialMonthClosing), avec une heure limite d'envoi conseillée
// (submitBy) pour laisser le temps de facturer. Sans clôture saisie, un mois
// se termine à minuit le dernier jour du mois calendaire, heure du pays.

const { addDays, localInstant, localParts, minutesOf, zoneOf } = require("./submission-schedule.service");

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const LOCAL_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

function isMonthKey(value) {
  return MONTH_PATTERN.test(String(value || ""));
}

function addMonths(key, months) {
  const [, y, m] = MONTH_PATTERN.exec(key);
  const date = new Date(Date.UTC(Number(y), Number(m) - 1 + months, 1));
  return date.toISOString().slice(0, 7);
}

function monthLabel(key) {
  const [, y, m] = MONTH_PATTERN.exec(key);
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", month: "long", year: "numeric" }).format(
    new Date(Date.UTC(Number(y), Number(m) - 1, 15)),
  );
}

const monthOf = (instant, zone) => localParts(instant, zone).date.slice(0, 7);
const calendarEnd = (key, zone) => localInstant(`${addMonths(key, 1)}-01`, "00:00", zone);

// closings : Map "YYYY-MM" -> { closesAt: Date, submitBy: Date|null }.
function toClosingMap(rows = []) {
  return new Map(
    rows.map((row) => [
      row.month,
      { closesAt: new Date(row.closesAt), submitBy: row.submitBy ? new Date(row.submitBy) : null },
    ]),
  );
}

const endOf = (key, closings, zone) => closings.get(key)?.closesAt || calendarEnd(key, zone);

// Mois commercial auquel compte un instant (de facturation).
function commercialMonthAt(instant, closings, zone) {
  const calendar = monthOf(instant, zone);
  for (const key of [addMonths(calendar, -1), calendar, addMonths(calendar, 1)]) {
    const start = endOf(addMonths(key, -1), closings, zone);
    if (start <= instant && instant < endOf(key, closings, zone)) return key;
  }
  return calendar;
}

// Ce que le site affiche : mois en cours, sa clôture et l'envoi conseillé.
function describeCommercialMonth(rows, countryCode, now = new Date()) {
  const zone = zoneOf(countryCode);
  const closings = toClosingMap(rows);
  const month = commercialMonthAt(now, closings, zone);
  const closing = closings.get(month) || null;
  const next = addMonths(month, 1);
  return {
    month,
    label: monthLabel(month),
    next,
    nextLabel: monthLabel(next),
    timeZone: zone,
    closesAt: endOf(month, closings, zone).toISOString(),
    calendarEnd: calendarEnd(month, zone).toISOString(),
    submitBy: closing?.submitBy ? closing.submitBy.toISOString() : null,
    hasClosing: Boolean(closing),
    serverNow: now.toISOString(),
  };
}

// « 2026-11-03T13:00 » (heure du pays) <-> instant.
function fromLocalInput(value, zone) {
  const match = LOCAL_PATTERN.exec(String(value || ""));
  if (!match || minutesOf(match[2]) === null || minutesOf(match[2]) === 24 * 60) return null;
  const instant = localInstant(match[1], match[2], zone);
  // Rejette les dates impossibles (31 novembre…) que Date.UTC décalerait.
  return localParts(instant, zone).date === match[1] ? instant : null;
}

function toLocalInput(instant, zone) {
  if (!instant) return "";
  const parts = localParts(new Date(instant), zone);
  return `${parts.date}T${String(Math.floor(parts.minutes / 60)).padStart(2, "0")}:${String(parts.minutes % 60).padStart(2, "0")}`;
}

// Valide une clôture saisie par l'admin. Renvoie { data } ou { errors }.
function validateClosing({ month, closesAtLocal, submitByLocal }, countryCode, neighbours = {}) {
  const zone = zoneOf(countryCode);
  const errors = {};
  if (!isMonthKey(month)) return { errors: { month: "Choisissez un mois." } };
  const closesAt = fromLocalInput(closesAtLocal, zone);
  const submitBy = submitByLocal ? fromLocalInput(submitByLocal, zone) : null;
  const monthStart = localInstant(`${month}-01`, "00:00", zone);
  // Une clôture tombe dans le mois lui-même ou dans le mois suivant.
  const latest = calendarEnd(addMonths(month, 1), zone);
  if (!closesAt) errors.closesAt = "Saisissez la date et l’heure de clôture.";
  else if (closesAt <= localInstant(addDays(`${month}-01`, 14), "00:00", zone) || closesAt >= latest)
    errors.closesAt = "La clôture doit tomber dans la seconde moitié du mois ou au cours du mois suivant.";
  else if (neighbours.previous && closesAt <= neighbours.previous)
    errors.closesAt = "La clôture doit suivre celle du mois précédent.";
  else if (neighbours.next && closesAt >= neighbours.next)
    errors.closesAt = "La clôture doit précéder celle du mois suivant.";
  if (submitByLocal && !submitBy) errors.submitBy = "Date d’envoi conseillé invalide.";
  else if (submitBy && closesAt && (submitBy > closesAt || submitBy < monthStart))
    errors.submitBy = "L’envoi conseillé doit précéder la clôture.";
  return Object.keys(errors).length ? { errors } : { data: { month, closesAt, submitBy } };
}

function serializeClosing(row, countryCode) {
  const zone = zoneOf(countryCode);
  return {
    id: row.id,
    month: row.month,
    label: monthLabel(row.month),
    closesAt: new Date(row.closesAt).toISOString(),
    closesAtLocal: toLocalInput(row.closesAt, zone),
    submitBy: row.submitBy ? new Date(row.submitBy).toISOString() : null,
    submitByLocal: toLocalInput(row.submitBy, zone),
    updatedByLabel: row.updatedByLabel || null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

module.exports = {
  isMonthKey,
  addMonths,
  monthLabel,
  toClosingMap,
  commercialMonthAt,
  describeCommercialMonth,
  fromLocalInput,
  toLocalInput,
  validateClosing,
  serializeClosing,
};
