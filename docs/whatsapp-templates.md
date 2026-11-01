# Catalogue des modèles WhatsApp (MailerSend / Meta)

Texte exact à saisir dans **MailerSend → WhatsApp → Templates** pour chaque
notification client. Ce fichier fait référence : `buildPreorderTemplateVariables`
(`src/services/whatsapp.service.js`) doit produire les variables **dans l'ordre
indiqué ici**. Toute modification d'un texte approuvé impose une nouvelle
approbation Meta et une mise à jour de ce fichier.

## Règles communes

| Paramètre | Valeur |
|---|---|
| Catégorie | **Utility** pour tous les modèles (jamais Marketing) |
| Langue | `fr` (français) |
| Nom | minuscules + `_`, préfixe `fbo_` (précommandes) ou `ticket_` (billetterie) |
| Pied de page | `Forever Living Products` (fixe, identique partout) |

Contraintes Meta respectées par les textes ci-dessous (à vérifier en cas de
modification) :

- le corps ne commence ni ne finit par une variable ;
- deux variables ne se suivent jamais sans texte entre elles ;
- les variables sont numérotées `{{1}}`, `{{2}}`… sans trou ;
- une valeur de variable ne contient **ni retour à la ligne, ni tabulation, ni
  plus de 4 espaces consécutifs**, et n'est **jamais vide** (le code envoie `-`
  à défaut) ;
- aucune URL dans le corps : les liens passent par un **bouton URL dynamique**
  (partie fixe déclarée dans le modèle + suffixe `{{1}}` envoyé par le code) ;
- ton strictement transactionnel (pas de promotion, pas d'emoji commercial),
  sinon Meta reclasse le modèle en Marketing, plus cher.

`{BASE}` = adresse web publique de l'application (`APP_PUBLIC_BASE_URL`, ex.
`https://forevercivstore.com`). Elle est unique pour tous les pays (le pays est
porté par le jeton ou le paramètre `country` du lien) : un seul jeu de modèles
suffit. Si un pays passe un jour sur un domaine distinct, il faudra dupliquer
les modèles à bouton (1, 3, 4, 6, 11, 14, 15) pour ce domaine.

Pays : les textes sont volontairement neutres (« Forever », pas « FOREVER CI »)
pour servir tous les pays avec le même jeu de modèles.

## Récapitulatif

| # | Nom du modèle | Déclencheur (purpose / flux) | Variables | Bouton |
|---|---|---|---|---|
| 1 | `fbo_invoice_wave` | INVOICE, PAYMENT_LINK — Wave | 5 | URL dynamique |
| 2 | `fbo_invoice_cash` | INVOICE — espèces / comptoir | 5 | – |
| 3 | `fbo_invoice_bank` | INVOICE — virement, Ecobank Pay, PI SPI | 7 | URL dynamique |
| 4 | `fbo_reminder_wave` | REMINDER — Wave | 4 | URL dynamique |
| 5 | `fbo_reminder_cash` | REMINDER — espèces / comptoir | 4 | – |
| 6 | `fbo_reminder_bank` | REMINDER — virement, Ecobank Pay, PI SPI | 5 | URL dynamique |
| 7 | `fbo_payment_confirmed` | PAYMENT_CONFIRMED | 3 | – |
| 8 | `fbo_preparation_started` | PREPARATION_STARTED | 2 | – |
| 9 | `fbo_order_ready_pickup` | ORDER_READY — retrait comptoir | 4 | – |
| 10 | `fbo_order_ready_shipping` | ORDER_READY — expédition | 3 | – |
| 11 | `fbo_shipping_payment` | SHIPPING_PAYMENT_LINK | 6 | URL dynamique |
| 12 | `fbo_order_fulfilled_pickup` | ORDER_FULFILLED — retrait comptoir | 3 | – |
| 13 | `fbo_order_fulfilled_shipping` | ORDER_FULFILLED — expédition | 4 | – |
| 14 | `ticket_reminder` | Rappel billet (`ticket-sms-reminder.service.js`) | 2 | URL dynamique |
| 15 | `ticket_portal_hint` | Plusieurs achats billetterie | 2 | URL fixe |

---

## 1. `fbo_invoice_wave`

Préfacture prête, paiement par lien Wave.

**Corps**

```
Bonjour {{1}},

Votre précommande {{2}} est prête pour le paiement.

Code encaissement : {{3}}
Montant à payer : {{4}}

Cette préfacture reste payable pendant {{5}} heures. Appuyez sur le bouton ci-dessous pour payer avec Wave.
```

**Bouton** — URL dynamique, texte `Payer avec Wave`,
URL `{BASE}/payment/{{1}}`

| Variable | Contenu | Champ du contexte | Exemple |
|---|---|---|---|
| `{{1}}` | Nom du FBO | `customerName` | `KOUASSI Aya` |
| `{{2}}` | N° de précommande | `preorderNumber` | `CIV-20261101-0042` |
| `{{3}}` | Code encaissement | `paymentCollectionCode` | `A7K2Q` |
| `{{4}}` | Montant | `totalFcfaLabel` | `48 500 FCFA` |
| `{{5}}` | Délai de paiement (h) | `paymentExpiryHours` | `48` |
| bouton `{{1}}` | Fin du lien de paiement | fin de `paymentLink` après `/payment/` | `w/eyJ0b2tlbiI6...` |

Le bouton s'arrête à `/payment/` (et non `/payment/w/`) pour couvrir aussi la
forme longue du lien (`/payment/wave/<id>?country=CIV`) utilisée quand le
jeton court n'est pas disponible.

## 2. `fbo_invoice_cash`

Préfacture prête, règlement en espèces au comptoir.

**Corps**

```
Bonjour {{1}},

Votre précommande {{2}} est prête pour le paiement.

Code encaissement : {{3}}
Montant à payer : {{4}}

Présentez ce code au comptoir pour régler. Cette préfacture reste payable pendant {{5}} heures. Votre commande sera préparée après validation du paiement.
```

Variables : identiques au modèle 1 (`{{1}}` à `{{5}}`). Pas de bouton.

## 3. `fbo_invoice_bank`

Préfacture prête, paiement par virement / Ecobank Pay / PI SPI puis dépôt de
la preuve.

**Corps**

```
Bonjour {{1}},

Votre précommande {{2}} est prête pour le paiement.

Code encaissement : {{3}}
Montant à payer : {{4}}
Mode de paiement : {{5}}
Compte bénéficiaire : {{6}}

Après votre paiement, appuyez sur le bouton ci-dessous pour déposer votre preuve. Cette préfacture reste payable pendant {{7}} heures.
```

**Bouton** — URL dynamique, texte `Déposer ma preuve`,
URL `{BASE}/payment/{{1}}`

| Variable | Contenu | Champ du contexte | Exemple |
|---|---|---|---|
| `{{1}}` à `{{4}}` | comme le modèle 1 | | |
| `{{5}}` | Libellé du mode | dérivé de `paymentFlow` : `Virement bancaire` / `Ecobank Pay` / `PI SPI` | `Virement bancaire` |
| `{{6}}` | Coordonnées du compte (réglages du pays) | `bankAccountDetails`, sinon `affiché sur la page de dépôt de preuve` | `FLP CI - Ecobank - CI059 01001 ...` |
| `{{7}}` | Délai de paiement (h) | `paymentExpiryHours` | `48` |
| bouton `{{1}}` | Fin du lien de dépôt | fin de `paymentLink` après `/payment/` | `b/eyJ0b2tlbiI6...` |

Le compte figure aussi sur la page de dépôt de preuve (même source : réglages
du pays), pour que le FBO l'ait sous les yeux au moment du paiement.

## 4. `fbo_reminder_wave`

**Corps**

```
Bonjour {{1}},

Rappel : votre précommande {{2}} est toujours en attente de paiement.

Code encaissement : {{3}}
Montant à payer : {{4}}

Appuyez sur le bouton ci-dessous pour payer avec Wave avant l'expiration de la préfacture.
```

**Bouton** — URL dynamique, texte `Payer avec Wave`, URL `{BASE}/payment/{{1}}`

Variables `{{1}}` à `{{4}}` : comme le modèle 1.

## 5. `fbo_reminder_cash`

**Corps**

```
Bonjour {{1}},

Rappel : votre précommande {{2}} est toujours en attente de paiement.

Code encaissement : {{3}}
Montant à payer : {{4}}

Présentez ce code au comptoir pour régler avant l'expiration de la préfacture.
```

Variables `{{1}}` à `{{4}}` : comme le modèle 1. Pas de bouton.

## 6. `fbo_reminder_bank`

**Corps**

```
Bonjour {{1}},

Rappel : votre précommande {{2}} est toujours en attente de paiement.

Code encaissement : {{3}}
Montant à payer : {{4}}
Mode de paiement : {{5}}

Si vous avez déjà payé, appuyez sur le bouton ci-dessous pour déposer votre preuve.
```

**Bouton** — URL dynamique, texte `Déposer ma preuve`, URL `{BASE}/payment/{{1}}`

Variables `{{1}}` à `{{5}}` : comme le modèle 3.

## 7. `fbo_payment_confirmed`

**Corps**

```
Bonjour {{1}},

Le paiement de votre précommande {{2}} est confirmé pour un montant de {{3}}.

Vous recevrez une nouvelle notification dès le lancement de la préparation.
```

| Variable | Contenu | Champ du contexte | Exemple |
|---|---|---|---|
| `{{1}}` | Nom du FBO | `customerName` | `KOUASSI Aya` |
| `{{2}}` | N° de précommande | `preorderNumber` | `CIV-20261101-0042` |
| `{{3}}` | Montant | `totalFcfaLabel` | `48 500 FCFA` |

## 8. `fbo_preparation_started`

**Corps**

```
Bonjour {{1}},

Votre colis {{2}} est en cours de préparation.

Vous recevrez une nouvelle notification dès qu'il sera prêt.
```

| Variable | Contenu | Champ du contexte | Exemple |
|---|---|---|---|
| `{{1}}` | Nom du FBO | `customerName` | `KOUASSI Aya` |
| `{{2}}` | N° de colis | `parcelNumber` | `COL-0042` |

## 9. `fbo_order_ready_pickup`

**Corps**

```
Bonjour {{1}},

Votre colis {{2}} est prêt à être retiré.

Code de retrait : {{3}}
Lieu de retrait : {{4}}

Présentez ce code au comptoir. Sans ce code, le retrait peut être refusé. Ne le communiquez qu'à la personne chargée du retrait.
```

| Variable | Contenu | Champ du contexte | Exemple |
|---|---|---|---|
| `{{1}}` | Nom du FBO | `customerName` | `KOUASSI Aya` |
| `{{2}}` | N° de colis | `parcelNumber` | `COL-0042` |
| `{{3}}` | Code de retrait | `pickupCode` | `583920` |
| `{{4}}` | Lieu de retrait | `pickupAddress` (réglages pays), sinon la ville du pays ci-dessous | `Bureau FLP, ABIDJAN` |

Ville par défaut si aucune adresse de retrait n'est renseignée dans les réglages
du pays :

| Pays | Code | Ville |
|---|---|---|
| Côte d'Ivoire | CIV | ABIDJAN |
| Burkina Faso | BFA | OUAGADOUGOU |
| Bénin | BEN | COTONOU |
| Niger | NER | NIAMEY |
| Togo | TGO | LOME |

L'adresse doit tenir sur une ligne (contrainte Meta : pas de retour à la ligne
dans une variable) ; le code remplace les retours à la ligne par `, `.

## 10. `fbo_order_ready_shipping`

**Corps**

```
Bonjour {{1}},

Votre colis {{2}} est prêt pour l'expédition par {{3}}.

Si des frais d'expédition sont à régler, vous recevrez un message séparé et les retrouverez dans votre espace client.
```

| Variable | Contenu | Source | Exemple |
|---|---|---|---|
| `{{1}}` | Nom du FBO | `customerName` | `KOUASSI Aya` |
| `{{2}}` | N° de colis | `parcelNumber` | `COL-0042` |
| `{{3}}` | Transporteur | `carrierLabel(deliveryMode)` | `Coditrans` |

## 11. `fbo_shipping_payment`

Frais d'expédition à régler (produits déjà payés).

**Corps**

```
Bonjour {{1}},

Les frais d'expédition par {{2}} de votre précommande {{3}} sont disponibles.

Frais d'expédition : {{4}}
Frais de paiement Wave : {{5}}
Total à régler : {{6}}

Vos produits sont déjà payés : ce règlement concerne uniquement l'expédition. Appuyez sur le bouton ci-dessous pour payer.
```

**Bouton** — URL dynamique, texte `Payer l'expédition`,
URL `{BASE}/external-payment/{{1}}`

| Variable | Contenu | Source | Exemple |
|---|---|---|---|
| `{{1}}` | Nom du FBO | `customerName` | `KOUASSI Aya` |
| `{{2}}` | Transporteur | `carrierLabel(deliveryMode)` | `Coditrans` |
| `{{3}}` | N° de précommande | `preorderNumber` | `CIV-20261101-0042` |
| `{{4}}` | Frais d'expédition | `shippingPaymentLink.baseAmountFcfa` | `3 000 FCFA` |
| `{{5}}` | Frais Wave | `shippingPaymentLink.serviceFeeFcfa` | `30 FCFA` |
| `{{6}}` | Total | `shippingPaymentLink.amountFcfa` | `3 030 FCFA` |
| bouton `{{1}}` | Jeton + pays | `{token}?country={code}` (fin de `paymentUrl(order)`) | `a1b2c3?country=CIV` |

## 12. `fbo_order_fulfilled_pickup`

**Corps**

```
Bonjour {{1}},

Le retrait du colis {{2}} est confirmé. Votre précommande {{3}} est clôturée.

Merci pour votre confiance.
```

| Variable | Contenu | Champ du contexte | Exemple |
|---|---|---|---|
| `{{1}}` | Nom du FBO | `customerName` | `KOUASSI Aya` |
| `{{2}}` | N° de colis | `parcelNumber` | `COL-0042` |
| `{{3}}` | N° de précommande | `preorderNumber` | `CIV-20261101-0042` |

## 13. `fbo_order_fulfilled_shipping`

**Corps**

```
Bonjour {{1}},

Votre colis {{2}} a été remis à {{3}}.

Numéro de bordereau : {{4}}

La remise au transporteur ne vaut pas confirmation de livraison au destinataire. Le suivi est disponible dans votre espace client.
```

| Variable | Contenu | Source | Exemple |
|---|---|---|---|
| `{{1}}` | Nom du FBO | `customerName` | `KOUASSI Aya` |
| `{{2}}` | N° de colis | `parcelNumber` | `COL-0042` |
| `{{3}}` | Transporteur | `carrierLabel(deliveryMode)` | `Coditrans` |
| `{{4}}` | Bordereau | `deliveryTracking`, sinon `non renseigné` | `CDT-778812` |

## 14. `ticket_reminder`

> **Non soumis pour l'instant** (modèles 14 et 15) : la billetterie reste en SMS
> seul tant que le consentement des acheteurs n'est pas recueilli. Textes
> conservés pour plus tard ; non branchés dans le code.

Lien vers le billet d'un acheteur (public non FBO).

**Corps**

```
Bonjour {{1}},

Voici l'accès à votre billet pour l'événement {{2}}.

Appuyez sur le bouton ci-dessous pour l'afficher. Présentez-le à l'entrée.
```

**Bouton** — URL dynamique, texte `Voir mon billet`, URL `{BASE}/tickets/{{1}}`

| Variable | Contenu | Source | Exemple |
|---|---|---|---|
| `{{1}}` | Nom de l'acheteur | `buyerFullName`, sinon `cher client` | `KOUASSI Aya` |
| `{{2}}` | Titre de l'événement | `event.title` | `Success Day 2026` |
| bouton `{{1}}` | N° commande + paramètres | fin de `ticketOrderUrl(order)` après `/tickets/` | `TK-0042?country=CIV&token=...` |

## 15. `ticket_portal_hint`

Envoyé une seule fois par numéro quand l'acheteur a plusieurs commandes.

**Corps**

```
Bonjour {{1}},

Vous avez plusieurs achats pour l'événement {{2}}.

Appuyez sur le bouton ci-dessous pour retrouver tous vos billets au même endroit.
```

**Bouton** — URL **fixe**, texte `Mes billets`, URL `{BASE}/tickets`

Variables `{{1}}` et `{{2}}` : comme le modèle 14.

---

## Décisions

| Sujet | Décision (2026-11-01) |
|---|---|
| Domaine des boutons | Unique pour tous les pays → un seul jeu de modèles |
| Lieu de retrait | Variable `{{4}}` du modèle 9 : adresse des réglages pays, sinon ville (ABIDJAN, OUAGADOUGOU, COTONOU, NIAMEY, LOME) |
| Compte bénéficiaire | Dans le message (modèle 3, `{{6}}`) **et** sur la page de dépôt de preuve |
| Pied de page | `Forever Living Products`, identique pour tous les pays (pas de mention par pays pour l'instant) |
| Consentement FBO | Considéré comme acquis par la relation FBO / Forever : pas de case à cocher, envoi WhatsApp à tous les FBO (modèles 1 à 13) |
| Billetterie | SMS seul ; modèles 14 et 15 non soumis tant qu'aucun consentement n'est recueilli sur le formulaire d'achat |

## Correspondance avec le code

| Modèle | Variable d'environnement (ID MailerSend) |
|---|---|
| 1 | `MAILERSEND_WHATSAPP_TEMPLATE_INVOICE_WAVE` |
| 2 | `MAILERSEND_WHATSAPP_TEMPLATE_INVOICE_CASH` |
| 3 | `MAILERSEND_WHATSAPP_TEMPLATE_INVOICE_BANK` |
| 4 | `MAILERSEND_WHATSAPP_TEMPLATE_REMINDER_WAVE` |
| 5 | `MAILERSEND_WHATSAPP_TEMPLATE_REMINDER_CASH` |
| 6 | `MAILERSEND_WHATSAPP_TEMPLATE_REMINDER_BANK` |
| 7 | `MAILERSEND_WHATSAPP_TEMPLATE_PAYMENT_CONFIRMED` |
| 8 | `MAILERSEND_WHATSAPP_TEMPLATE_PREPARATION_STARTED` |
| 9 | `MAILERSEND_WHATSAPP_TEMPLATE_ORDER_READY_PICKUP` |
| 10 | `MAILERSEND_WHATSAPP_TEMPLATE_ORDER_READY_SHIPPING` |
| 11 | `MAILERSEND_WHATSAPP_TEMPLATE_SHIPPING_PAYMENT` |
| 12 | `MAILERSEND_WHATSAPP_TEMPLATE_ORDER_FULFILLED_PICKUP` |
| 13 | `MAILERSEND_WHATSAPP_TEMPLATE_ORDER_FULFILLED_SHIPPING` |

Choix du modèle (`resolveWhatsAppTemplateKey`) : pour une facture ou une
relance, présence d'un lien + mode bancaire → `BANK`, lien sinon → `WAVE`,
pas de lien → `CASH` ; pour colis prêt / clôturé, mode de livraison expédition
→ `SHIPPING`, sinon `PICKUP`. Un purpose sans modèle (ex. `PREORDER_SUBMITTED`,
`AUTO_CANCEL`) échoue sur WhatsApp au lieu d'emprunter un texte inadapté.

## Point ouvert

- **Surveillance** : suivre la note de qualité du numéro dans MailerSend / Meta
  après la mise en service ; une baisse signale des blocages ou signalements et
  justifierait d'ajouter un consentement explicite côté FBO.
