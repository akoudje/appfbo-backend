# Notifications de paiement — onglet « En attente paiement »

Règles validées le 2026-11-12.

## Qui peut faire quoi

| | Superviseurs facturation (responsable facturation, directeur commercial, admins) | Agents de vente |
|---|---|---|
| Voir si la notification est partie (par canal, heure, erreur) | oui | oui (leurs commandes) |
| Renvoi d'une commande (« Renvoyer ») | oui | oui (leurs commandes) |
| Renvoi groupé | oui | non |

## Renvoi groupé

- Vise les commandes du pays en `billingWorkStatus = WAITING_PAYMENT`, statut `INVOICED` ou `PAYMENT_PENDING`, non payées ; 200 au maximum par lancement (les plus anciennes d'abord).
- Écarte : commande notifiée il y a moins de **30 min**, paiement Wave ouvert depuis moins de 30 min, commande payée, ni téléphone ni email. Chaque commande est revérifiée juste avant son envoi.
- Aperçu avant envoi, puis tâche en arrière-plan avec suivi et compte rendu (envoyées, en file, échecs, écartées).
- Un seul renvoi groupé à la fois par pays (409 sinon).
- Chaque envoi passe par le même chemin que « Renvoyer » (`performInvoiceResend`) : nouveau lien Wave valable 3 h, ancien lien coupé, ligne de journal « Notification de paiement renvoyée (renvoi groupé) » avec l'auteur.

La tâche est gardée en mémoire (une instance d'API) ; son compte rendu reste consultable une heure.

## API

- `GET /api/admin/billing/payment-notifications?ids=a,b` — état par commande (`PREORDER_READ`).
- `POST /api/admin/billing/payment-notifications/bulk-preview` — aperçu (superviseurs).
- `POST /api/admin/billing/payment-notifications/bulk-resend` — lancement, 202 (superviseurs).
- `GET /api/admin/billing/payment-notifications/bulk-resend/:jobId|current` — suivi (superviseurs).

Aucune migration.

## Tests

`node --test billing-payment-notifications.test.cjs`
