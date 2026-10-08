# Module Commandes

## Livraison

Déployer le backend et l’administration ensemble. Ce changement utilise les colonnes existantes et ne crée pas de migration. La base doit déjà être à jour selon les rollouts Paramètres et Utilisateurs.

- La page `/orders` demande explicitement les brouillons et annulations : « Toutes » couvre désormais tous les statuts du pays sélectionné. Les autres files conservent leurs paramètres et leur périmètre existants.
- `includeStats=true` ajoute `stats.statusCounts`, calculé sur tous les résultats filtrés, sans dépendre de la pagination.
- `GET /api/admin/orders/export` exporte la vue filtrée en CSV UTF-8, sous permission `EXPORT_READ`, dans le même pays. Limite : 10 000 lignes. Les cellules de texte pouvant être interprétées comme des formules sont neutralisées.
- Le tri accepte `billingPriority` et l’ancien alias `priority`. Les dates, statuts et périodes invalides produisent une erreur 400.

## Protection des mutations

Un `UPDATE` conditionnel de la commande est exécuté en début de transaction : pays, statut, paiement et état des réservations doivent toujours correspondre au dossier lu. Il prend le verrou sur la ligne jusqu’à la fin de l’opération. Une requête concurrente devenue obsolète reçoit 409 avant tout mouvement de stock.

Cette protection couvre annulation, lancement en caisse, préparation, remise et régularisation, ainsi que les changements de checklist et créations d’anomalies. La checklist et les anomalies bloquantes sont vérifiées dans la transaction de préparation. Une anomalie bloquante empêche également la remise normale. La validation groupée et son annulation sont disponibles pendant la préparation lancée.

Le motif d’annulation doit être une chaîne non vide de 1 à 1 000 caractères. L’annulation conserve l’état du paiement : le remboursement reste un traitement distinct.

## Interface

- Filtres, tri et pagination dans l’URL ; retour depuis la fiche vers la vue d’origine.
- Vues métier selon les permissions, tableau compact et cartes sur téléphone, indicateurs globaux repliables sur mobile.
- Résumé client, montant explicitement indicatif/confirmé/attendu et prochaine action visible. Montant AS400 absent : « Non reçu » ; un zéro est conservé.
- Référence, paiement, préparation et historique gardent leurs liens d’onglet existants. Les vues de traitement et annulation sont secondaires, avec annulation toujours directement accessible aux utilisateurs autorisés.
- Chargement de fiche protégé contre les réponses obsolètes, erreur explicite avec réessai, préservation des saisies et abandon confirmé. Les opérations ne sont pas lancées deux fois par double clic.
- Historique et notifications chargés à la demande ; erreurs secondaires visibles. Les outils Wave sont réservés au développement et au rôle technique.

## Validation

- Backend : `node --test orders-regression.test.cjs preparation-regression.test.cjs settings-regression.test.cjs users-security-regression.test.cjs customer-portal-regression.test.cjs external-payment-links-regression.test.cjs ticket-events-regression.test.cjs`.
- Administration : `node --test orders-model.test.mjs parcel-label.test.mjs settings-model.test.cjs users-model.test.cjs`, compilation Vite et lint des fichiers modifiés.
- Test réel exécuté avec Prisma sur une instance PostgreSQL 18 temporaire indépendante : deux annulations concurrentes, stock initial 100, quantité 5, stock final 105, une réussite et un conflit 409. Aucune connexion à une base existante.
- Contrôle des composants React réels avec API entièrement simulée : affichage bureau/mobile, erreur initiale, réponse retardée, saisie conservée après actualisation. Largeur mobile contrôlée : 430 px, sans débordement horizontal.

Après déploiement, vérifier les vues sous facturier, caisse, préparateur et supervision ; comparer le CSV aux filtres ; actualiser une fiche avec une saisie ; tester la validation groupée ; confirmer les refus sur commande terminée. Effectuer les essais de stock sur des commandes de test dédiées.
