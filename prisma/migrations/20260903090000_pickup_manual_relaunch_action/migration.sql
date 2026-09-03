-- Relance manuelle groupée d'un/plusieurs colis prêts non retirés (bouton
-- "Relancer" dans la file de préparation et la page Retraits en retard) :
-- nouvelle valeur d'enum distincte des relances automatiques
-- (PICKUP_REMINDER_SENT/PICKUP_OVERDUE_FLAGGED) pour tracer qui a
-- déclenché l'envoi et servir de garde-fou anti-spam (1 relance/jour/commande,
-- tous types confondus).

ALTER TYPE "PreorderLogAction" ADD VALUE 'PICKUP_MANUAL_RELAUNCH';
