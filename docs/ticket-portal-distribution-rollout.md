# Mes tickets et distribution aux invités

## Fonctionnement

Le lien « Mes tickets » est disponible dans la navigation du site et de la billetterie. `/tickets` permet une connexion par email et code OTP, sans numéro FBO. L’ancienne URL `/tickets/recover` ouvre aussi cet espace ; le renvoi historique d’un lien d’achat reste disponible dans `/tickets/recover-link`.

Dans le parcours email, le code est envoyé exclusivement à l’email saisi, même lorsqu’il n’existe pas encore d’achat associé : la demande ne révèle pas l’existence d’un acheteur. Ce parcours affiche uniquement les achats dont l’email de l’acheteur correspond à l’adresse vérifiée dans le pays choisi. Il ne rapproche jamais une commande par téléphone, nom, email d’un invité ou numéro FBO. Les achats d’événements clôturés restent accessibles dans ce portail. Un parcours SMS distinct est ajouté dans [ticket-sms-recovery-rollout.md](ticket-sms-recovery-rollout.md), avec une migration supplémentaire.

Le code expire après dix minutes, ne permet que cinq essais, et ne peut être consommé qu’une fois, même lors de vérifications concurrentes. Un nouveau code invalide les anciens codes du même email/pays. Seul le HMAC du code est stocké. Les challenges expirés depuis plus de 24 heures sont nettoyés lors des nouvelles demandes. Les demandes sont limitées par IP, email/minute et email/heure. Aucun code n’est renvoyé dans la réponse API. Un échec du fournisseur email est affiché et invalide le challenge.

La session dure douze heures, avec un cookie HttpOnly `tpt`, Secure en production, SameSite=Lax et limité à `/api/ticketing`. Elle est distincte de la session FBO et n’est pas enregistrée dans le stockage JavaScript. Les réponses privées ne sont pas mises en cache. Les mutations exigent du JSON ; les règles CORS existantes continuent de s’appliquer. Changer de pays nécessite une session vérifiée dans ce pays.

## Attribution et partage

Chaque ticket est présenté sur une carte compacte : numéro dans l’achat, référence, invité attribué, nombre de partages notés et état réel à l’entrée. Le QR s’ouvre à la demande et reste présent dans l’impression. Le client peut attribuer un nom, garder le ticket pour lui ou retirer l’attribution. L’attribution est une information d’organisation séparée des contacts de l’acheteur ; elle ne change ni le QR ni la validité du ticket. Le PDF individuel reprend le nom attribué lorsqu’il est renseigné.

Le partage principal porte désormais sur un lien invité individuel, utilisable directement dans WhatsApp, par email ou par le menu natif du téléphone. L’invité peut afficher son QR et télécharger son PDF sans connexion. Le lien ne permet ni d’ouvrir les autres tickets, ni de connaître les coordonnées de l’acheteur, ni de modifier l’attribution ou le suivi. Le jeton invité est signé pour un seul ticket et son QR ; il n’est pas un jeton d’accès à l’achat complet. Un ticket utilisé affiche son état sans renvoyer le QR ; un ticket annulé, remboursé ou non payé est refusé.

Avant un nouveau partage, le dialogue relit le suivi serveur. Si le billet a déjà été partagé, il affiche son attribution et exige une confirmation explicite. L’acheteur termine l’envoi dans son application puis clique sur « J’ai terminé le partage · le noter ». Un partage PDF réalisé ailleurs peut être noté via « Noter un partage effectué ailleurs ». Un téléchargement, l’ouverture de WhatsApp ou l’annulation du partage natif n’enregistre pas un envoi automatiquement.

L’historique conserve le canal, la date et le nom attribué au moment du partage. Les dix dernières entrées sont affichées ; le compteur inclut toutes les entrées. Les changements de nom ne réécrivent pas cet historique. Une modification après partage exige un avertissement explicite : les liens, captures et PDF déjà transmis restent utilisables avec le même QR.

Les mutations vérifient à nouveau le pays, la preuve d’accès à l’achat, son paiement et l’état du ticket sous verrou. Les éditions obsolètes sont refusées. L’enregistrement d’un partage est idempotent par ticket et identifiant d’action ; un historique modifié depuis un autre appareil exige une actualisation. Un lot invalide est annulé entièrement. Les billets déjà utilisés ne peuvent plus être attribués ou partagés.

Ce suivi repose sur la confirmation de l’acheteur. Il ne garantit pas la réception par l’invité et ne détecte pas le transfert d’une capture ou d’un PDF hors de l’application. Le contrôle d’entrée existant reste la protection contre la réutilisation du même QR. Aucun remplacement de ticket ni invalidation d’ancien QR n’est ajouté par cette livraison.

## Déploiement

Avant de déployer le backend, appliquer **`20261013130000_ticket_portal_distribution`** :

```sh
npx prisma migrate deploy
npx prisma generate
```

La migration ajoute deux champs nullable sur `Ticket`, l’historique `TicketShareEvent`, les challenges `TicketPortalOtpChallenge` et un index de recherche des achats par email/pays. Elle ne modifie aucun QR, prix, paiement ou statut existant. Le transport email et les secrets JWT existants sont réutilisés ; aucun compte FBO n’est requis. Déployer le backend avant le frontend. Actualiser les pages déjà ouvertes après livraison.

Les évolutions précédentes des archives admin et du filtrage public restent incluses ; elles n’exigent pas de migration supplémentaire. Les liens d’achat complets et les anciens PDF restent compatibles.

## Validation

- Backend : `node --test ticket-portal-distribution.test.cjs public-ticketing-regression.test.cjs ticket-events-regression.test.cjs`.
- Frontend : tests de distribution, de partage, des contrats, des sélections et du modèle de tickets ; lint ciblé et compilation.
- Contrôle navigateur avec données simulées : connexion email/OTP, achats associés, cinq cartes individuelles, attribution, avertissement avant repartage, confirmation manuelle de partage et lien invité limité à un ticket, à 390 et 1440 px.

Aucun email réel, paiement, migration de production ni changement de commande réelle n’est exécuté lors de la validation locale.
