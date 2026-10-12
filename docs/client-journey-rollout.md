# Parcours client simplifié

## Fonctionnement

- Un client connecté peut ouvrir directement le catalogue depuis « Nouvelle précommande ». `POST /api/customer/me/preorders` vérifie sa session et relit son grade dans le répertoire FBO. Les coordonnées préremplies proviennent uniquement de son propre compte et de ses commandes dans le pays actif.
- Sur Step1Form, un numéro reconnu suffit : les champs de nom et de grade sont masqués. Le backend relit le répertoire et enregistre le nom et le grade officiels. La confirmation du bénéficiaire reste au récapitulatif.
- Step2Catalog est consacré au choix des produits : le nom du client, son numéro FBO et son grade n'y sont pas affichés. Les tarifs restent calculés selon le grade côté serveur ; une information générique rappelle leur caractère indicatif. Les informations de commande restent accessibles à la demande, et le bouton retour permet de revenir à l'identification.
- « Commander pour un autre FBO » suit le même principe de résolution automatique du numéro reconnu ; les coordonnées du titulaire du compte ne sont pas utilisées comme coordonnées du bénéficiaire.
- La reprise d'une commande relit le grade actuel avant de recalculer le panier. L'indisponibilité du répertoire interdit ces raccourcis aux tarifs personnalisés.
- Si un appel API fournit explicitement un nom pour un numéro reconnu, le backend contrôle sa correspondance. La comparaison tolère accents, casse, ponctuation et ordre des mots, sans accepter un nom partiel. Une erreur ne révèle pas le nom attendu. Aucun nom ni aucune coordonnée n'est ajouté à la réponse publique de vérification du numéro.
- En repli manuel, le grade déclaré ne donne aucune remise personnalisée : le brouillon utilise `CLIENT_PRIVILEGIE`, avec un avertissement de prix de référence indicatifs dans le catalogue. Une requête publique ne remplace pas l'email d'un profil existant.
- Le récapitulatif conserve les coordonnées, le choix de livraison, la confirmation d'identité du bénéficiaire et le consentement explicite. Les cases restent décochées ; l'envoi ne nécessite plus un deuxième dialogue.
- Le lien « Suivre ma précommande » ouvre sa commande dans le portail après authentification. Le serveur conserve le contrôle d'appartenance, même si l'identifiant du lien est modifié.
- Le portail affiche uniquement la liste ou le détail sur mobile. Le retour, y compris le bouton du navigateur, conserve les filtres, la recherche et la position de la liste. Sur ordinateur, la liste et le détail restent côte à côte, avec une liste de hauteur limitée.
- Le détail commence par un résumé et des actions persistantes. Trois produits sont visibles ; les autres produits, le suivi complet et les instructions de paiement peuvent être ouverts à la demande. Les justificatifs et les informations de retrait restent accessibles.
- L'annulation nécessite une confirmation dans une fenêtre accessible au clavier, sans défilement jusqu'au bas de la commande. Seules les précommandes `SUBMITTED` non payées peuvent être annulées ; le serveur revalide leur état au moment de l'action.
- La réponse de commande fournit `capabilities.canCancel` et `capabilities.canReorder`, ainsi que `itemsCount` dans la liste. Les identifiants internes FBO ne sont pas exposés. Une commande placée pour un autre bénéficiaire ne propose pas de reprise de panier depuis le compte de son initiateur.
- La reprise utilise le pays de la commande et le grade actuel. Elle tient compte des disponibilités du pays, des limites de quantité et des prix disponibles pour ce grade. Les lignes retirées ou réduites sont signalées au récapitulatif ; les cases d'identité et de consentement restent décochées. Les moyens de paiement désactivés dans le pays ne sont pas réintroduits.

## Contrats et confidentialité

La nouvelle route exige le cookie client HttpOnly ou le transport Bearer natif déjà pris en charge, ainsi qu'une clé d'idempotence. La clé est isolée par compte côté serveur. `sessionFboNumero` protège contre un changement de compte entre affichage et création ; il ne constitue pas une preuve d'authentification.

Les réponses de commandes ajoutent `viewerNumeroFbo` afin que le frontend puisse refuser une réponse provenant d'un autre compte. Les réponses tardives de brouillon, catalogue, récapitulatif ou soumission ne doivent pas rétablir l'ancien état après un changement d'identité ou de pays.

Les vues du portail interrogent le serveur avec `ACTIVE` (en cours), `TO_PAY` (facturées/en attente de paiement, non payées), `READY`, `HISTORY` (annulées/terminées) et `ALL`. Elles conservent la pagination, la recherche et le périmètre du client et du pays.

L'OTP demeure exclusivement envoyé par email. Aucun jeton d'authentification web n'est ajouté au stockage JavaScript. Le catalogue public avant identification reste hors de cette livraison.

## Déploiement

Aucune migration supplémentaire ni nouvelle variable d'environnement n'est nécessaire. Le répertoire FBO, la configuration email et les paramètres de cookies/CORS existants doivent fonctionner.

Pour le correctif « numéro reconnu sans saisie du nom/grade », déployer le backend avant le frontend : il accepte de nouveau un numéro reconnu seul et résout son profil automatiquement. L'ancien backend exigeait encore le nom. Actualiser les clients après livraison. Le frontend propose le formulaire d'identification si le raccourci du portail est momentanément indisponible ; il refuse une réponse de raccourci sans preuve `identityVerified: true`.

Pour la navigation compacte du portail, livrer également le backend avant le frontend afin de disposer des capacités d'action et des ajustements de reprise de panier. Aucune migration supplémentaire. Vérifier une liste paginée, le retour mobile et navigateur, une commande de vingt produits, une annulation concurrente avec la facturation, un justificatif bancaire, une commande pour un autre FBO et une reprise dans un pays différent du catalogue actif.

Vérifier en recette : numéro reconnu seul jusqu'au catalogue (aucun champ nom/grade) ; numéro inconnu avec saisie obligatoire du nom et du grade ; connexion email ; commande pour soi et pour un autre FBO ; nom explicitement fourni incohérent ; changement de grade ; répertoire indisponible ; changement de compte/pays ; consentement décoché ; filtres du portail ; lien de suivi ; billets payés affichés avant le récapitulatif financier. Les QR et actions de billets restent conditionnés au paiement confirmé.

## Validation locale

Pour le retrait FLP présélectionné et les nouvelles expéditions La Poste / Coditrans, consulter [shipping-rollout.md](shipping-rollout.md). Ce complément nécessite une migration et un paiement d’expédition distinct, déterminé par le préparateur.

```powershell
node --test client-journey-regression.test.cjs customer-portal-regression.test.cjs orders-regression.test.cjs
```

Dans `frontend`, exécuter `client-journey-store.test.mjs` et les suites `ticketing-*.test.mjs`/`ticket-share.test.mjs`, puis ESLint sur les fichiers modifiés et la compilation. Les scénarios navigateur utilisent des API simulées : ils ne déclenchent ni commande réelle, ni email, ni paiement.
