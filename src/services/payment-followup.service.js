// Fenêtre de relance d'une commande annulée sans paiement.
//
// Règle métier (validée le 30/10/2026) : une commande vit au plus un jour
// ouvrable. Elle peut être relancée pendant les heures d'ouverture de
// l'agence, le jour même de son annulation ; une fois l'agence fermée, elle
// doit être reprise entièrement (nouvelle commande).
//
// « Agence ouverte » = caisse globale du comptoir ouverte (userId null, voir
// cash-register-closure.service.js). Le jour est la date locale du pays.
// Les administrateurs globaux restent libres de relancer hors fenêtre
// (exceptions décidées par la direction) : le contrôle est fait par l'appelant.

const { getCashRegisterStatus } = require("./cash-register-closure.service");
const { timeZone } = require("./ticket-inventory.service");

function localDate(instant, zone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

async function checkRelaunchWindow({ countryId, countryCode, cancelledAt, now = new Date() }) {
  const register = await getCashRegisterStatus(countryId, null);
  if (!register.isOpen) {
    return {
      ok: false,
      code: "RELAUNCH_AGENCY_CLOSED",
      message:
        "La caisse du comptoir est fermée : une commande ne peut être relancée que pendant les heures d'ouverture de l'agence.",
    };
  }

  const zone = timeZone(String(countryCode || "").toUpperCase());
  if (!cancelledAt || localDate(new Date(cancelledAt), zone) !== localDate(now, zone)) {
    return {
      ok: false,
      code: "RELAUNCH_WINDOW_EXPIRED",
      message:
        "Cette commande a été annulée un jour précédent : elle ne peut plus être relancée et doit être reprise entièrement.",
    };
  }

  return { ok: true };
}

module.exports = { checkRelaunchWindow };
