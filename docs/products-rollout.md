# Module Produits

## Livraison

Déployer le backend et l’administration ensemble. Appliquer d’abord la migration `20261008120000_product_audit_log` avec `npx prisma migrate deploy`, puis régénérer le client avec `npx prisma generate`. La migration ajoute uniquement le journal `ProductAuditLog` et ses index ; elle ne modifie aucun stock ni tarif existant.

L’historique du catalogue commence au déploiement. Les opérations anciennes ne sont pas reconstruites. Les mouvements de stock existants restent consultables.

## Contrats API

- `GET /api/admin/products` conserve une réponse tableau pour les consommateurs sans pagination. Avec `page`/`pageSize`, il renvoie `items`, `totalCount`, `page`, `pageSize` et `stats` sur l’ensemble du résultat filtré. La page est ramenée dans la plage disponible. Tris : nom, SKU, stock, prix, dernière modification ; pays obligatoire et ordre stable.
- Filtres : recherche nom/SKU/code-barres, catégorie, actif, stock (`in`, `out`, `low`), incomplet (`incomplete=true`). Stock faible : 1 à 5 unités ; à compléter : image absente ou catégorie non classée.
- `GET /api/admin/products/export` : vue filtrée CSV UTF-8 avec BOM, limitée à 10 000 lignes ; nécessite `PRODUCT_READ` et `EXPORT_READ`. Les cellules susceptibles d’être interprétées comme des formules sont neutralisées.
- `GET /api/admin/products/:id/history` : journal paginé (30 entrées), limité au produit disponible et au pays courant, sous `PRODUCT_READ`.
- `PUT /api/admin/products/:id` ne modifie que les champs transmis. `stockQty` est refusé : utiliser `/api/admin/stock/adjust`. Les valeurs `null` ou vides d’un tarif dans `gradePrices` retirent le tarif spécifique ; zéro reste un tarif valide.
- `expectedUpdatedAt` et `expectedCountryUpdatedAt` protègent l’édition contre une fiche devenue obsolète (409). Le frontend les transmet et conserve les saisies en cas de conflit.
- Une création avec un SKU existant renvoie 409 ; elle n’écrase plus la fiche commune. Pour ajouter un produit partagé à un autre pays, utiliser la copie de catalogue.
- `DELETE /api/admin/products/:id` désactive la disponibilité du pays ; il conserve stock, prix, limites et références de commande. Le frontend utilise également une modification explicite de l’activation. La suppression d’un conditionnement devient sa désactivation réversible.

## Stock et conditionnements

Les fiches produits affichent le stock en lecture seule après création. Un ajustement exige un motif (1 à 1 000 caractères), une quantité entière ou un écart entier et, sur les interfaces modifiées, le stock précédemment affiché. Lecture, écriture conditionnelle et mouvement sont dans la même transaction. Un débit concurrent ou un ajustement concurrent devenu obsolète reçoit 409 ; un écart ne peut pas être tronqué ou ramener silencieusement une quantité négative à zéro.

La création enregistre le stock initial du pays dans les mouvements. Les modifications communes, locales, les images, les imports et les conditionnements écrivent le journal du catalogue dans la transaction correspondante. Les conditionnements vérifient la disponibilité dans le pays courant. Leurs caractéristiques et tarifs restent communs aux pays, conformément au modèle existant, et cette portée est affichée dans l’interface.

## Imports et copie

L’import comporte un aperçu serveur (`dryRun=true`), la détection des doublons et erreurs, puis une confirmation. Toute ligne invalide empêche l’écriture du fichier complet. Limite : 1 000 lignes, fichier client de 2 Mo maximum. Les colonnes absentes ou facultatives vides préservent les valeurs existantes. Le stock d’un produit existant reste intact, même si une colonne de stock est présente. Pour retirer un tarif ou une valeur facultative, utiliser la fiche ; l’API accepte également un null explicite.

Les changements d’informations communes sont explicitement confirmés. Le frontend transmet le `previewToken` reçu ; un catalogue modifié depuis l’aperçu est refusé. Un SKU disponible uniquement dans un autre pays est signalé pour éviter une modification commune involontaire.

La copie est réservée au `SUPER_ADMIN` disposant de `PRODUCT_WRITE`. Source et destinations sont sélectionnées explicitement et un aperçu précède l’exécution. Les stocks existants sont toujours conservés, même avec `overwrite=true`. Les ajouts démarrent à zéro. Les prix par grade présents dans la source sont copiés ; les tarifs absents de la source ne suppriment pas ceux de la destination. Les modifications concurrentes des destinations provoquent un conflit et annulent la transaction.

## Interface et validation

- Charte noire et jaune, tableau compact, cartes sur téléphone, filtres/tri/pagination conservés dans l’URL, actions selon permissions effectives.
- Fiches regroupant informations communes, tarifs et disponibilité du pays. Images préparées dans le formulaire et envoyées à l’enregistrement, sans réinitialiser les autres saisies. Les erreurs gardent le formulaire ouvert. Réessayer une création dont seule l’image a échoué réutilise le produit créé.
- Confirmation avant le retour à la liste, les liens internes ou le rechargement d’une fiche modifiée ; avertissement natif à la fermeture/actualisation. Le bouton Retour du navigateur n’est pas intercepté par le routeur existant.
- Backend : `node --test products-regression.test.cjs orders-regression.test.cjs preparation-regression.test.cjs settings-regression.test.cjs users-security-regression.test.cjs customer-portal-regression.test.cjs external-payment-links-regression.test.cjs ticket-events-regression.test.cjs`.
- Administration : `node --test products-model.test.mjs orders-model.test.mjs parcel-label.test.mjs settings-model.test.cjs users-model.test.cjs`, lint des fichiers modifiés et compilation Vite.
- Validation réelle : schéma et migration SQL sur PostgreSQL 18 local isolé, vrais contrôleurs/Prisma, ajustements et modifications concurrents (une réussite, un conflit), retrait de tarif, import, copie et désactivation sans perte de stock.
- Contrôle React avec API simulée : vues bureau/mobile, droits en lecture seule, dialogues, saisies conservées après erreur, image préparée sans upload immédiat, aucune erreur JavaScript et largeur mobile 430 px sans débordement.

Après déploiement, vérifier la lecture seule, les prix par grade et leur calcul de secours dans une précommande, l’activation dans deux pays, un import de test et un ajustement motivé. Les essais physiques de stock doivent porter sur des produits de test dédiés.
