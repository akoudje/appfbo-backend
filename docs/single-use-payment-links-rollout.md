# Liens de paiement Wave à usage unique (précommandes)

Règles validées le 2026-11-10 :

- un lien de paiement est valable **3 h** après son envoi ;
- seul le **dernier lien envoyé** est valable : un nouvel envoi (facture, rappel, renvoi, bascule vers Wave) rend les précédents inutilisables ;
- un lien ne sert qu'à **un seul paiement** : commande payée ou annulée, le lien est refusé ;
- **une seule session Wave ouverte** par commande : une session ouverte récente est reprise, sinon les anciennes sont fermées chez Wave (`POST /v1/checkout/sessions/:id/expire`) avant d'en créer une nouvelle. Les sessions restées ouvertes sur une commande payée, annulée ou au lien expiré sont fermées par la tâche périodique des précommandes ;
- un lien expiré ou remplacé affiche **« Demander un nouveau lien »** : la demande arrive dans « Renvois de lien » ; rien n'est envoyé au client sans intervention de l'équipe.

## Déploiement

Appliquer la migration **avant** de déployer le code : le code lit la nouvelle colonne.

```
npx prisma migrate deploy
npx prisma generate
```

La migration `20261111100000_add_preorder_payment_link_issued_at` ajoute une colonne nullable `Preorder.paymentLinkIssuedAt`. Aucune donnée existante n'est modifiée.

Déployer ensuite le backend, puis le frontend client (pages `/payment/w/:token` et `/payment/wave/:orderId`).

## Liens déjà envoyés

Les liens envoyés avant le déploiement (ancien format, non daté) restent valables 3 h après le dernier envoi enregistré pour la commande, puis expirent. Dès qu'un nouveau lien est envoyé, ils sont remplacés.

## Liens hors précommande (EXT, QR) et frais d’expédition

- Échéance plafonnée à **3 h** après la création, même si une échéance plus lointaine est demandée.
- Un seul paiement par lien (déjà le cas : un lien payé passe « Payé ») et une seule session Wave : la session ouverte récente est reprise, sinon l’ancienne est fermée chez Wave avant d’en ouvrir une autre.
- Un lien annulé ferme sa session Wave ; l’annulation est refusée si un paiement est en cours ou reçu.
- La tâche périodique passe « Expiré » les liens échus **et les anciens liens actifs sans échéance créés il y a plus de 3 h** (y compris des liens d’expédition en attente) : au premier passage après le déploiement, ces anciens liens expirent. Pour les frais d’expédition, réenregistrer les frais crée un nouveau lien et renvoie la notification.

## Hors périmètre

- Application mobile : un lien expiré y affiche le message du serveur ; le bouton « Demander un nouveau lien » viendra avec la prochaine version de l'APK.

## Tests

`node --test single-use-payment-links.test.cjs` (16 tests).
