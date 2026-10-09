# Billetterie publique

## Déploiement

Livrer le backend, le frontend public et le petit ajustement de signalement dans l’administration ensemble. Appliquer d’abord `20261008150000_public_ticket_purchase` avec `npx prisma migrate deploy`, puis `npx prisma generate`. La migration ajoute quatre colonnes nullable à `TicketOrder` (prix des frais, total payable, identifiant de tentative et code de vérification des tickets) ainsi qu’un index unique pays/tentative. Aucun prix, paiement ou ticket historique n’est modifié par la migration.

## Réservation et concurrence

La création prend un verrou sur l’événement avant de vérifier puis enregistrer l’achat. Les tickets actifs/utilisés, les achats payés sans tickets en attente d’émission et les achats en attente encore réservés sont comptés dans les capacités de l’événement et de chaque catégorie. Les billets RESERVED historiques sont comptés séparément de leur commande pour éviter un double comptage.

La réservation dure 30 minutes, suivies de la marge de confirmation Wave existante (`TICKET_ORDER_WAVE_FINALIZATION_GRACE_MINUTES`, 15 minutes par défaut). Après ce délai, la réservation ne consomme plus de places. Le scheduler vérifie Wave avant expiration et reporte l’expiration en cas d’erreur réseau. Son écriture finale est verrouillée et ne peut plus remplacer un achat payé.

Les ventes en caisse et l’activation manuelle utilisent le même contrôle de capacité. L’émission verrouille événement puis achat, relit la quantité et les tickets et ne génère pas un deuxième jeu lors de confirmations concurrentes. Les achats historiques payés sans tickets peuvent être réparés par synchronisation, sans nouvel encaissement.

Un paiement tardif sans capacité disponible reste enregistré comme payé, avec `ticketIssueCode=CAPACITY_CONFLICT` et sans émission supplémentaire. Le client voit un message de vérification et le contact d’assistance configuré ; l’administration affiche un indicateur et propose de revérifier les tickets. Après libération réelle de places, cette vérification peut émettre les billets et retirer le signalement. Un remboursement reste une décision et une opération distinctes.

Avant livraison, examiner les achats historiques en attente : ils sont désormais pris en compte dans les capacités. Une réservation historique déjà supérieure à la capacité doit être traitée par l’équipe ; aucune commande n’est supprimée automatiquement par ce changement.

Le début de l’événement ne ferme pas automatiquement les ventes lorsqu’aucune date de fin n’est renseignée : seuls le statut, les dates d’ouverture/clôture des ventes et une date de fin explicite les contrôlent.

## Prix et reprise

- `POST /api/ticketing/events/:slug/quote` confirme la quantité, le prix unitaire, le sous-total, les frais et le montant payable. Les ventes fermées ou capacités insuffisantes sont refusées. Le frontend n’autorise pas la continuation avant réception du devis serveur.
- La création transmet `expectedAmountToPayFcfa` ; un changement de prix avant enregistrement provoque un conflit et demande une nouvelle vérification. Les frais et le total de la nouvelle commande sont enregistrés. Les anciennes commandes sans ces colonnes utilisent le calcul de secours existant, avec leur mode de paiement.
- `clientRequestId` est un identifiant aléatoire d’une tentative, unique par pays. Une répétition des mêmes coordonnées, catégorie et quantité reprend la commande ; un contenu différent est refusé. La session du navigateur garde cet identifiant avant envoi et le lien sécurisé après réponse.
- `POST /api/ticketing/orders/resume` reprend une tentative à partir de cet identifiant aléatoire, sous limitation de requêtes. Il doit être traité comme une information personnelle de reprise. Aucun identifiant séquentiel n’est utilisé.
- Une panne de lancement Wave ne masque plus la commande créée : le frontend reçoit sa référence, son jeton et un message pour reprendre le paiement. Une session Wave déjà ouverte et valide est réutilisée sous verrou de commande ; les appels simultanés ne créent pas plusieurs sessions.
- Les billets gratuits sont réservés puis activés dans la transaction sans session Wave.

Les consultations, relances et synchronisations publiques continuent d’exiger le jeton signé. Les réponses publiques sélectionnent uniquement les informations nécessaires : les sessions et réponses brutes du prestataire ne sont plus retournées. Les tickets RESERVED ne publient pas leurs QR codes.

## Interface publique

Pages adaptatives : événements, fiche, paiement, récupération. Les listes distinguent événements à venir/terminés, ventes ouvertes/fermées et complet. Recherche, dates et pays restent dans l’URL ; les prix minimums correspondent aux billets disponibles et zéro est présenté comme gratuit. Les horaires utilisent le fuseau du pays du lieu (pays pris en charge : CIV/BFA/TGO/BEN/NER, UTC par défaut pour un pays non référencé).

Le formulaire associe les libellés aux champs, limite la quantité aux places disponibles, affiche les frais et le total serveur et conserve les saisies lors d’un échec. L’actualisation des places et tarifs est explicite. La réservation est directement accessible sur mobile.

Les états en attente, confirmation en cours, tentative échouée, délai écoulé, expiré, annulé, payé, émission en cours et réservation à vérifier ont des messages distincts. Le paiement est masqué une fois le délai écoulé ou l’achat terminé. Le suivi transmet pays et jeton, ignore les réponses obsolètes, ne régresse pas depuis payé, sérialise les opérations et vérifie uniquement lorsque la page est visible.

La récupération renvoie un lien à l’adresse déjà associée à l’achat payé, en attente ou expiré, avec une réponse neutre. Les courriers de reprise ne promettent pas de tickets actifs avant paiement. L’assistance téléphonique provient de `supportPhone` dans la configuration du pays.

Le PDF propose un billet individuel ou un document groupé, une page par billet. Les pages imprimées contiennent uniquement les cartes de tickets et des QR codes lisibles. Le générateur PDF et les routes de billetterie sont chargés à la demande.

## Validation

- Backend : `node --test public-ticketing-regression.test.cjs products-regression.test.cjs orders-regression.test.cjs preparation-regression.test.cjs settings-regression.test.cjs users-security-regression.test.cjs customer-portal-regression.test.cjs external-payment-links-regression.test.cjs ticket-events-regression.test.cjs`.
- Public : `node --test ticketing-model.test.mjs`, lint des fichiers modifiés et `npm run build`.
- Administration : lint de `TicketEventsPage.jsx` et compilation.
- PostgreSQL réel isolé : application de la migration SQL, deux achats sur la dernière place (201/409), vente en caisse refusée si place réservée, répétition d’achat avec une seule session Wave, confirmations parallèles avec une seule émission/email, expiration ne remplaçant pas payé, et deux billets gratuits sans appel Wave. Tous les prestataires et emails de ce contrôle sont simulés.
- Navigateur avec API entièrement simulée : composants React réels à 390/1024/1440 px sans débordement, quantité et total serveur, conservation du lien et du jeton, suivi sécurisé, paiement absent sur achat expiré, PDF à deux pages et mise en page d’impression sans boutons.

Après déploiement, utiliser un événement de test pour confirmer le retour Wave réel, l’email reçu, la lecture du QR par l’application de contrôle et la reprise d’une tentative interrompue. Vérifier également un événement complet et une vente en caisse. Ces vérifications réelles de prestataire et de scan physique n’ont pas été exécutées dans les tests locaux.

## Compatibilité du parcours public pendant le déploiement

Le frontend accepte aussi l’ancien catalogue contenant `status` sans `salesStatus`. Un événement publié ne devient pas terminé simplement parce que son heure de début est passée ; la fin et les périodes de vente explicites restent respectées.

Avec l’ancienne API, ou uniquement si la route de devis est absente (404 de route), le formulaire prépare l’achat puis présente le sous-total, les frais et le total effectivement renvoyés par le serveur avant d’ouvrir Wave. Aucun pourcentage de frais n’est inventé dans le navigateur. Les erreurs de devis métier, les erreurs serveur et les totaux incohérents ne permettent pas de contourner la confirmation du montant.

Un lien Wave déjà préparé pour le même achat, le même pays et le même jeton peut être réutilisé après confirmation du total, tant que l’achat reste payable et non expiré. Les achats payés, échoués ou remboursés ne réutilisent pas ce lien. Le pays et le jeton restent conservés même avec les anciennes réponses de commande.

Si une catégorie se remplit après actualisation, les autres catégories restent accessibles. Une nouvelle catégorie ou quantité proposée doit être confirmée avant la continuation ; les coordonnées saisies sont conservées.

Cette compatibilité rétablit le parcours existant pendant un déploiement progressif. Les garanties serveur nouvelles (réservation atomique et reprise par identifiant de tentative) nécessitent toujours la livraison du backend actuel et sa migration. Elle ne remplace pas cette mise à jour.

Tests complémentaires frontend : `node --test ticketing-model.test.mjs ticketing-contracts.test.mjs ticketing-selection.test.mjs`. Contrôle navigateur avec APIs simulées : ancien contrat, contrat actuel, route de devis absente, panne de devis, vente fermée, catégorie épuisée après rafraîchissement, conservation des coordonnées et confirmation du total avant Wave. Aucun achat réel n’est exécuté par ces contrôles.

## Compteur de disponibilités et commandes admin

La synthèse admin fournit `availability.remaining` à partir des capacités des billets actifs, limitées par la capacité globale lorsqu’elle est renseignée. Les billets utilisés et actifs ainsi que les réservations encore valides consomment les places. Les achats en attente sans billets émis sont aussi comptés, sans compter deux fois les achats possédant déjà des billets réservés. Une capacité de zéro reste zéro ; une catégorie active sans limite et sans capacité globale est affichée comme « Sans limite ».

Les statistiques de ventes restent calculées sur l’ensemble de l’événement et ne dépendent pas du filtre de la table. Le filtre initial des commandes est `PAID`, y compris après une réinitialisation ou un changement d’événement. Le choix explicite d’un autre statut ou de tous les statuts reste disponible et est conservé pendant la pagination.

L’admin accepte les anciennes synthèses pour un tarif unique, ainsi que plusieurs tarifs lorsque les compteurs par catégorie suffisent à confirmer le résultat. Lorsque l’ancienne API ne fournit pas la répartition des réservations entre plusieurs catégories, le compteur indique « À confirmer » plutôt que d’inventer leur répartition. Le nouveau backend fournit le calcul complet. Aucun endpoint public supplémentaire n’est requis. Ces changements n’ajoutent aucune migration ; le prérequis de migration billetterie indiqué plus haut reste applicable au déploiement du backend complet.

Vérifications : `node --test ticket-events-regression.test.cjs public-ticketing-regression.test.cjs` côté backend et `node --test ticket-events-model.test.mjs` côté admin. Contrôle navigateur isolé : compteur sur ancien et nouveau contrat, statut initial payé, filtres attente/annulé/tous, réinitialisation, pagination et changement d’événement. Aucune commande ni aucun paiement réel n’est créé.
