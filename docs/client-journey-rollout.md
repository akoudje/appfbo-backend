# Parcours client simplifié

## Fonctionnement

- Un client connecté peut ouvrir directement le catalogue depuis « Nouvelle précommande ». `POST /api/customer/me/preorders` vérifie sa session et relit son grade dans le répertoire FBO. Les coordonnées préremplies proviennent uniquement de son propre compte et de ses commandes dans le pays actif.
- Sur Step1Form, un numéro reconnu suffit : les champs de nom et de grade sont masqués. Le backend relit le répertoire et enregistre le nom et le grade officiels. La confirmation du bénéficiaire reste au récapitulatif.
- « Commander pour un autre FBO » suit le même principe de résolution automatique du numéro reconnu ; les coordonnées du titulaire du compte ne sont pas utilisées comme coordonnées du bénéficiaire.
- La reprise d'une commande relit le grade actuel avant de recalculer le panier. L'indisponibilité du répertoire interdit ces raccourcis aux tarifs personnalisés.
- Si un appel API fournit explicitement un nom pour un numéro reconnu, le backend contrôle sa correspondance. La comparaison tolère accents, casse, ponctuation et ordre des mots, sans accepter un nom partiel. Une erreur ne révèle pas le nom attendu. Aucun nom ni aucune coordonnée n'est ajouté à la réponse publique de vérification du numéro.
- En repli manuel, le grade déclaré ne donne aucune remise personnalisée : le brouillon utilise `CLIENT_PRIVILEGIE`, avec un avertissement de prix de référence indicatifs dans le catalogue. Une requête publique ne remplace pas l'email d'un profil existant.
- Le récapitulatif conserve les coordonnées, le choix de livraison, la confirmation d'identité du bénéficiaire et le consentement explicite. Les cases restent décochées ; l'envoi ne nécessite plus un deuxième dialogue.
- Le lien « Suivre ma précommande » ouvre sa commande dans le portail après authentification. Le serveur conserve le contrôle d'appartenance, même si l'identifiant du lien est modifié.

## Contrats et confidentialité

La nouvelle route exige le cookie client HttpOnly ou le transport Bearer natif déjà pris en charge, ainsi qu'une clé d'idempotence. La clé est isolée par compte côté serveur. `sessionFboNumero` protège contre un changement de compte entre affichage et création ; il ne constitue pas une preuve d'authentification.

Les réponses de commandes ajoutent `viewerNumeroFbo` afin que le frontend puisse refuser une réponse provenant d'un autre compte. Les réponses tardives de brouillon, catalogue, récapitulatif ou soumission ne doivent pas rétablir l'ancien état après un changement d'identité ou de pays.

Les vues du portail interrogent le serveur avec `ACTIVE` (en cours), `TO_PAY` (facturées/en attente de paiement, non payées), `READY`, `HISTORY` (annulées/terminées) et `ALL`. Elles conservent la pagination, la recherche et le périmètre du client et du pays.

L'OTP demeure exclusivement envoyé par email. Aucun jeton d'authentification web n'est ajouté au stockage JavaScript. Le catalogue public avant identification reste hors de cette livraison.

## Déploiement

Aucune migration supplémentaire ni nouvelle variable d'environnement n'est nécessaire. Le répertoire FBO, la configuration email et les paramètres de cookies/CORS existants doivent fonctionner.

Pour le correctif « numéro reconnu sans saisie du nom/grade », déployer le backend avant le frontend : il accepte de nouveau un numéro reconnu seul et résout son profil automatiquement. L'ancien backend exigeait encore le nom. Actualiser les clients après livraison. Le frontend propose le formulaire d'identification si le raccourci du portail est momentanément indisponible ; il refuse une réponse de raccourci sans preuve `identityVerified: true`.

Vérifier en recette : numéro reconnu seul jusqu'au catalogue (aucun champ nom/grade) ; numéro inconnu avec saisie obligatoire du nom et du grade ; connexion email ; commande pour soi et pour un autre FBO ; nom explicitement fourni incohérent ; changement de grade ; répertoire indisponible ; changement de compte/pays ; consentement décoché ; filtres du portail ; lien de suivi ; billets payés affichés avant le récapitulatif financier. Les QR et actions de billets restent conditionnés au paiement confirmé.

## Validation locale

```powershell
node --test client-journey-regression.test.cjs customer-portal-regression.test.cjs orders-regression.test.cjs
```

Dans `frontend`, exécuter `client-journey-store.test.mjs` et les suites `ticketing-*.test.mjs`/`ticket-share.test.mjs`, puis ESLint sur les fichiers modifiés et la compilation. Les scénarios navigateur utilisent des API simulées : ils ne déclenchent ni commande réelle, ni email, ni paiement.
