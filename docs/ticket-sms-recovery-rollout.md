# Récupération des tickets par SMS

## Parcours client

« Mes tickets » propose Email et SMS lorsque le transport Orange est configuré pour un pays compatible. L’accès SMS utilise exclusivement le téléphone de l’acheteur enregistré sur `TicketOrder.buyerPhone`. Il ne recherche pas le téléphone d’un invité, celui du payeur Wave, un nom ou un numéro FBO. Le téléphone ne peut pas être remplacé dans ce parcours. Les achats existants peuvent être retrouvés sans vérification préalable après achat.

Les formats national, international, avec `+` ou `00` sont normalisés pour la Côte d’Ivoire (225, dix chiffres) et le Burkina Faso (226, huit chiffres). Les autres pays restent accessibles par email ; leur normalisation SMS n’est pas compatible avec le transport actuel. L’API `/portal/capabilities` expose seulement la disponibilité des canaux, sans secret ni donnée d’acheteur.

La demande SMS renvoie toujours la même réponse neutre pour un numéro ou une référence inconnus. Aucun SMS n’est envoyé à un numéro sans achat correspondant. Un challenge sans correspondance est immédiatement rendu inutilisable. L’envoi d’un SMS valide est déclenché après la réponse pour ne pas révéler une correspondance par la durée d’appel du fournisseur. Un refus du transport consomme le challenge et produit un journal technique sans OTP. L’acceptation par le fournisseur n’est pas une garantie de réception. Après une interruption du processus backend, le client peut demander un nouveau code une fois le délai écoulé ou utiliser son email.

Après vérification du code :

- Un téléphone associé à un seul acheteur ouvre les achats de ce téléphone dans le pays choisi. Il n’ouvre pas les autres achats de son email enregistrés avec un autre téléphone.
- Si des noms ou des emails d’acheteurs diffèrent, une référence d’achat est obligatoire avant toute liste ou émission de jeton d’accès. Sans email, plusieurs achats sont considérés comme ambigus même si leurs noms sont identiques. L’accès est limité à la référence choisie.
- Une référence peut aussi être fournie avant la demande de code : elle limite d’emblée l’accès à cet achat. Elle doit correspondre au téléphone et au pays vérifiés.
- La portée est contrôlée à nouveau lors de la lecture de session et de la liste. L’ajout d’un autre acheteur sur le même téléphone ne doit pas élargir une session existante. La liste utilise un instantané de lecture PostgreSQL pour garder cohérentes cette vérification et la sélection des achats.

La session SMS expose un téléphone masqué, jamais l’email de l’acheteur. Une session en attente de référence expire après quinze minutes ; les sessions d’accès durent douze heures. Le cookie HttpOnly, Secure en production, SameSite=Lax et le contrôle de pays restent identiques au parcours email.

## Vérification facultative après paiement

Un volet replié sur la page de l’achat payé permet de vérifier le téléphone sans alourdir le paiement ou masquer les tickets. L’envoi nécessite le jeton d’accès à l’achat complet et vise le numéro déjà enregistré, sans champ permettant de choisir un autre destinataire. Un lien invité n’autorise pas cette action.

Le code de vérification est lié à l’achat et au but `PHONE_BIND`. Il ne peut pas servir de code de connexion, et l’inverse est également refusé. La confirmation enregistre le téléphone canonique et sa date sur l’achat. Un changement ultérieur de numéro invalide le badge de vérification ; un achat non payé ou remboursé ne permet pas cette confirmation.

Si le client n’a accès ni à l’email ni au téléphone d’achat, l’interface l’oriente vers l’assistance avec la référence et le justificatif de paiement. Aucun changement automatique de coordonnées ni accès par un numéro de remplacement n’est ajouté. La connexion à l’espace client FBO reste exclusivement par email.

## Codes et limites d’envoi

Les OTP SMS expirent en dix minutes, acceptent cinq essais et sont consommés une seule fois sous verrou. Seul un HMAC lié au pays, au canal, au téléphone, au but et à la référence interne de l’achat est stocké. Un nouveau code remplace les précédents du même téléphone, pays et but. Les codes email en cours et les sessions email existantes restent compatibles.

Les demandes sont limitées à cinq par IP en dix minutes, un SMS par destination et par minute et trois par heure. Les demandes de connexion et de vérification après achat partagent le budget SMS d’une même destination canonique ; reformater un numéro ne contourne pas ces limites. Les essais de code et de référence disposent aussi de limites. Les mutations exigent du JSON, les réponses privées ne sont pas mises en cache et les règles CORS existantes continuent de s’appliquer.

Pour plusieurs instances backend, utiliser la configuration existante `RATE_LIMIT_STORE=database` afin de partager ces budgets. Le mode mémoire conserve les limites dans chaque processus ; un redémarrage ou plusieurs instances ne partagent pas ces compteurs. Les challenges expirés depuis plus de vingt-quatre heures sont nettoyés lors des nouvelles demandes.

## Migration et livraison

Cette livraison nécessite **`20261013180000_ticket_sms_recovery`**, en plus de la migration du portail déjà appliquée. Dans le backend :

```sh
npx prisma migrate deploy
npx prisma generate
```

La migration rend l’email du challenge nullable, ajoute canal/téléphone/but/achat aux challenges, deux champs de vérification sur `TicketOrder` et deux index. Les anciennes lignes conservent `EMAIL` et `LOGIN`. Aucun QR, paiement, prix ou statut existant n’est modifié. Déployer ensuite le backend, puis le frontend, et actualiser les pages ouvertes.

Le transport Orange existant est réutilisé : `ORANGE_CLIENT_ID`, `ORANGE_CLIENT_SECRET`, `ORANGE_SENDER_ADDRESS`, `ORANGE_SENDER_NUMBER` pour CIV ; leurs variantes suffixées `_BFA` pour BFA. Les secrets JWT existants signent les codes et sessions. Aucun nouveau fournisseur ni secret client n’est requis. Une configuration manquante masque SMS et conserve Email.

## Validation

```sh
node --test ticket-portal-distribution.test.cjs ticket-sms-privacy.test.cjs public-ticketing-regression.test.cjs ticket-events-regression.test.cjs
```

Les régressions couvrent les formats de téléphone, les pays, les coordonnées inconnues, les numéros partagés, la référence d’achat, les tentatives/expiration/rejeu, les erreurs du fournisseur, le téléphone d’origine et la séparation des buts des codes. Elles préservent les parcours email, partage invité et paiement existants. Lint et compilation frontend sont complétés par un contrôle navigateur des formulaires, des refus de code/référence et de la vérification facultative à 390 et 1440 pixels, avec un transport simulé.

Aucun SMS ou email réel, paiement ni migration de production n’est exécuté pendant la validation locale. Après livraison, tester la réception sur un téléphone d’achat connu et vérifier que « Mes tickets » ouvre les tickets attendus.
