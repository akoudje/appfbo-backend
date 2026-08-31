// Ce fichier a été découpé en modules par domaine sous ./ticketEvents/
// (events, orders, checkin, reports) pour rester lisible — voir
// ./ticketEvents/index.js pour le détail. On garde ce point d'entrée avec
// le même nom de fichier pour ne pas casser le require existant dans
// routes/admin/ticketEvents.routes.js.
module.exports = require("./ticketEvents");
