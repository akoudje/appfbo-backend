// Point d'entrée du module billetterie admin. Le contrôleur original
// (1379 lignes) a été découpé par domaine pour rester lisible :
//   - events.js   : événements + types de billets + affiche
//   - orders.js   : commandes (vente cash, encaissement, Wave, annulation…)
//   - checkin.js  : contrôle d'accès (sessions, scan, audit)
//   - reports.js  : bilan, exports CSV, restitution
//   - shared.js   : helpers communs (CSV, dates, includes Prisma…)
// Ce fichier ne fait que ré-exporter la même surface que l'ancien
// ticketEvents.controller.js, pour que les routes n'aient rien à changer.

module.exports = {
  ...require("./events"),
  ...require("./orders"),
  ...require("./checkin"),
  ...require("./reports"),
};
