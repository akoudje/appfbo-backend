# Retrait FLP et expéditions La Poste / Coditrans

## Parcours livré

- Le récapitulatif présélectionne le retrait au siège FLP. La Poste et Coditrans sont disponibles pour les précommandes. La configuration publique les annonce avec `delivery.shipping: true` ; le réglage historique `enableDelivery` concerne la livraison à domicile et ne masque pas ces deux expéditions. Le réglage du retrait continue de s’appliquer au retrait FLP.
- Une expédition exige le nom complet, le téléphone et la ville du destinataire. Ces coordonnées sont distinctes de l’identité FBO et des contacts de notification de l’acheteur.
- La facture et le paiement des produits suivent le parcours actuel. Aucun tarif de transport ni nombre de cartons ne sont déduits automatiquement du panier.
- Après vérification complète des articles et résolution des anomalies, le préparateur renseigne le poids final emballé pour La Poste, ou le nombre réel de cartons pour Coditrans, puis saisit le montant des frais.
- Les frais sont déterminés avec la permission `PREPARATION_UPDATE`. Le rôle facturier `INVOICER` ne possède pas cette permission.
- Un lien de paiement Wave réservé à l’expédition est créé. Il reprend les frais de service Wave du parcours existant (1 %, arrondi supérieur), affichés séparément. Le paiement Wave doit être activé dans le pays pour une expédition payante.
- Le client retrouve ce paiement dans le détail de la commande, via une action visible, et dans la vue « À payer ». La confirmation retourne vers l’espace client.
- Après l’enregistrement d’un nouveau devis, une notification de paiement est envoyée à l’email de la commande et le SMS est placé dans la file d’envoi existante. Elle détaille uniquement les frais d’expédition, les frais Wave et le total séparé, avec un bouton de paiement. Les coordonnées du destinataire du colis ne remplacent pas celles du client à notifier.
- Le préparateur voit les états email/SMS et dispose de « Notifier le client » / « Renvoyer la notification » pour les devis déjà enregistrés ou un échec d’envoi. Une indisponibilité de notification ne remet pas en cause le devis sauvegardé. Un devis identique conserve son lien ; un premier envoi absent ou échoué peut être relancé sans recréer le paiement. Les SMS en attente ne sont pas ajoutés une seconde fois.
- Une commande sans email valide ni téléphone de notification de l’acheteur affiche une erreur explicite, même après rechargement. Un canal sans coordonnées est indiqué comme indisponible. Les erreurs de configuration ou d’authentification email sont distinguées sans exposer la réponse technique du fournisseur. L’admin conserve aussi le retour d’échec d’une tentative lorsque celle-ci n’a pas pu créer de message d’historique.
- La construction du lien d’expédition accepte, comme le paiement externe existant, un domaine configuré sans préfixe `https://`. Elle essaie les adresses publiques configurées avant le domaine public par défaut, ignore les adresses inutilisables, les identifiants intégrés et les domaines `admin.`, et retire les paramètres et fragments de l’adresse de base.
- Une erreur `ERR_INVALID_URL` dans le log `[shipping] notification failed` signifie que l’envoi a été interrompu lors de la construction d’une URL, avant la remise aux transports email/SMS. Le test de régression couvre une adresse publique sans protocole et une adresse invalide prioritaire : le devis existant peut être notifié sans modifier ses frais ni recréer son paiement. Après déploiement de cette correction, utiliser « Notifier le client » sur les devis qui n’ont encore aucun message enregistré.
- Le portail et les notifications mobiles signalent distinctement les frais d’expédition à régler. Les frais offerts et les frais déjà réglés ne déclenchent aucune nouvelle demande de paiement.
- Un montant inconnu reste « À déterminer ». Un montant explicitement fixé à zéro signifie « Expédition offerte ».
- Le colis ne peut être marqué prêt sans devis. La remise au transporteur, y compris une régularisation administrative, est bloquée jusqu’à confirmation du paiement des frais ; une expédition offerte passe cette étape.
- Une fois le paiement lancé, le montant est verrouillé. Si Wave confirme l’expiration de sa session, le préparateur peut réenregistrer les frais pour créer un nouveau lien. La vérification du paiement est disponible dans les deux interfaces de préparation.
- Les étiquettes reprennent le nom du destinataire, la ville et son téléphone. Les notifications d’expédition n’affichent aucun code de retrait et distinguent la remise au transporteur de la livraison au destinataire.
- Recommander un panier peut reprendre les coordonnées d’expédition, mais crée un nouveau devis et un nouveau paiement après préparation.

## Déploiement

### Vue de suivi des expéditions

La page admin `/preparation/shipments` et le bouton « Expéditions · La Poste et Coditrans » dans l’application préparateur affichent cinq étapes : à préparer (y compris finaliser un colis dont les frais sont déjà réglés), frais à fixer, attente du paiement des frais, prêts à expédier et remis au transporteur. Les compteurs et les lignes utilisent les mêmes filtres de pays, transporteur, destination et recherche, avec pagination côté serveur. La liste est actualisée toutes les 30 secondes.

La destination et les coordonnées du destinataire du colis sont affichées distinctement de celles du client FBO. Les badges séparent le paiement des produits de celui de l’expédition. La notification « colis prêt » est nommée « Notification expédition » pour les deux transporteurs et ne présente pas un code de retrait.

Une remise au transporteur exige une référence de bordereau et une date comprise entre la préparation et le moment de l’enregistrement. Le backend contrôle de nouveau le paiement des frais et les anomalies sous verrou avant de confirmer la remise. La référence, le transporteur, la date réelle et l’opérateur sont conservés ; l’état `FULFILLED` reste utilisé par les traitements existants mais est présenté comme « Remis au transporteur », sans affirmer une livraison au destinataire. Les anciennes remises sans référence restent consultables et ne sont pas réécrites.

Le préparateur peut joindre une photo JPG/PNG ou un PDF (8 Mo maximum) sur le web, et prendre ou choisir une photo dans l’APK. Les fichiers sont stockés dans Cloudinary en mode `authenticated` et servis par une route protégée par `PREPARATION_UPDATE`, dans le pays de la commande. Aucun lien Cloudinary du bordereau n’est envoyé au client ni exposé dans les réponses opérationnelles. Une pièce déjà jointe n’est pas remplacée silencieusement par un nouvel envoi. La consultation des PDF dans l’APK passe actuellement par l’espace web.

Après une remise normale, le client reçoit une notification email/SMS/push avec la référence, et retrouve le bordereau (référence et date, sans pièce interne) dans son espace client. La régularisation administrative conserve son comportement sans notification et exige aussi une référence pour une nouvelle expédition.

**Avant de déployer ce suivi**, appliquer `20261012190000_shipping_workspace` avec `npx prisma migrate deploy`, puis générer le client Prisma. Cette migration ajoute la date réelle de remise, le stockage du bordereau et l’index de la file ; elle ne modifie aucun paiement existant. Déployer backend, admin et frontend client, puis recompiler/distribuer l’APK **0.1.6 (versionCode 7)** : le nouveau sélecteur photo est un module natif. Aucune migration de production ni compilation EAS payante n’est lancée par la validation locale.

Tests complémentaires : `node --test shipping-workspace.test.cjs shipping-notifications.test.cjs orders-regression.test.cjs`.

Appliquer **avant de démarrer le nouveau backend** la migration `20261011120000_shipping_quotes` :

```sh
npx prisma migrate deploy
npx prisma generate
```

Déployer ensuite le backend, le frontend client et l’admin web. Recompiler puis distribuer l’APK du préparateur pour obtenir le nouveau panneau sur les téléphones. Les changements des imprimantes JK01 déjà présents dans le projet sont conservés.

Aucune modification des anciennes commandes de retrait ou de livraison à domicile n’est effectuée. Les expéditions ont des champs et un paiement distincts ; les montants `totalFcfa`, `as400InvoiceTotalFcfa` et les statuts du paiement des produits ne sont pas réécrits par le devis.

## Validation

La tarification d’expédition est journalisée avec l’action Prisma existante `REPRICE` et le marqueur `meta.event: SHIPPING_QUOTE`. Ce marqueur ne constitue pas une nouvelle valeur d’énumération et ne nécessite pas de migration. Les erreurs serveur inattendues du devis et de la vérification de paiement sont conservées dans les logs internes ; l’interface reçoit un message sans détails Prisma ni identifiants internes.

Sur Render, `/health` expose `revision`, issu de la variable système `RENDER_GIT_COMMIT`, pour confirmer la version réellement en ligne avant de tester une correction. Un push ou une fusion GitHub ne garantit pas à lui seul que le nouveau backend a fini son déploiement.

Tests de devis et paiement : `node --test shipping-regression.test.cjs`.
Non-régressions : `node --test customer-portal-regression.test.cjs client-journey-regression.test.cjs orders-regression.test.cjs preparation-regression.test.cjs external-payment-links-regression.test.cjs`.
Contrôles locaux : schéma Prisma, lint ciblé, compilations web et export du bundle Android, tests des étiquettes et du protocole JK01.

Avant ouverture aux clients, effectuer sur l’environnement de test une commande pour chacun des transporteurs : produits payés, checklist complète, devis, paiement Wave, vérification, puis remise. Vérifier aussi les frais offerts, une modification avant paiement, une session expirée, les coordonnées d’un destinataire différent du FBO et un essai de remise avec frais impayés. Aucun encaissement réel ni migration de production ne sont exécutés par les tests locaux.
