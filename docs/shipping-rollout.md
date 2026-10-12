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
- Le portail et les notifications mobiles signalent distinctement les frais d’expédition à régler. Les frais offerts et les frais déjà réglés ne déclenchent aucune nouvelle demande de paiement.
- Un montant inconnu reste « À déterminer ». Un montant explicitement fixé à zéro signifie « Expédition offerte ».
- Le colis ne peut être marqué prêt sans devis. La remise au transporteur, y compris une régularisation administrative, est bloquée jusqu’à confirmation du paiement des frais ; une expédition offerte passe cette étape.
- Une fois le paiement lancé, le montant est verrouillé. Si Wave confirme l’expiration de sa session, le préparateur peut réenregistrer les frais pour créer un nouveau lien. La vérification du paiement est disponible dans les deux interfaces de préparation.
- Les étiquettes reprennent le nom du destinataire, la ville et son téléphone. Les notifications d’expédition n’affichent aucun code de retrait et distinguent la remise au transporteur de la livraison au destinataire.
- Recommander un panier peut reprendre les coordonnées d’expédition, mais crée un nouveau devis et un nouveau paiement après préparation.

## Déploiement

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
