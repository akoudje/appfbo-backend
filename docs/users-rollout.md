# Déploiement de la gestion des utilisateurs

Cette évolution conserve les permissions et la matrice d’attribution des rôles existantes. Elle unifie les contrôles de création, modification, statut et réinitialisation du mot de passe.

## Migration préalable

La migration `20261006210000_admin_session_version` ajoute `AdminUser.sessionVersion`, entier initialisé à zéro.

Avant de démarrer le nouveau backend, appliquer les migrations et générer son client Prisma dans l’environnement habituel :

```sh
npx prisma migrate deploy
npx prisma generate
```

Déployer ensuite le backend puis l’administration. La nouvelle interface utilise les capacités d’action et la pagination retournées par le backend. Aucun changement de compte réel ou migration de production n’a été exécuté pendant l’implémentation locale.

## Sessions et accès

Chaque JWT nouvellement émis contient la version de session du compte. Le compte actif, son rôle, son pays et ses permissions sont relus avant les contrôles d’accès. Les anciens JWT sans version restent compatibles avec la version zéro ; la date de changement du mot de passe est également comparée à la date de création du token pour refuser les tokens antérieurs à cette rotation.

Un changement d’email, de mot de passe, de rôle, de pays, de statut ou de droits augmente la version et invalide les tokens précédents. Une réactivation ne rétablit pas les anciennes sessions. Un simple changement de nom ne déconnecte pas l’utilisateur. L’action « Déconnecter les sessions » permet une révocation explicite.

Les flux temps réel locaux concernés sont fermés après la validation de la transaction. Les flux d’autres instances sont contrôlés au prochain heartbeat (25 secondes maximum en fonctionnement normal).

Les comptes ne peuvent pas modifier leur propre rôle, pays, statut actif ou retirer leur accès à la gestion des utilisateurs. Le rôle actuel et le nouveau rôle du compte ciblé doivent être gérables par l’auteur. La conservation d’un Super Admin actif disposant de la gestion des utilisateurs est protégée dans une transaction sérialisable.

## Audit et interface

Chaque modification et son audit sont enregistrés dans la même transaction. Les mots de passe et leurs hashes sont exclus de l’historique. Les nouvelles écritures incluent les valeurs avant/après des informations publiques du compte ; les anciens événements conservent leurs informations historiques disponibles.

La liste affiche le total et la pagination serveur. Les filtres sont préservés après les mutations et les réponses devenues obsolètes sont ignorées. La fiche présente l’identité, les permissions effectives et l’activité. Les actions sensibles sont distinctes et confirmées. Une fiche devenue obsolète retourne 409 et doit être rechargée explicitement avant une nouvelle sauvegarde.

La politique de mot de passe reste de 12 caractères minimum avec au moins 3 types de caractères, et une limite de 72 octets pour éviter la troncature bcrypt.

Validation locale : tests de sécurité et de concurrence sur une base simulée, tests de formulaires, validation Prisma, build et lint, parcours navigateur sur ordinateur et téléphone avec des comptes fictifs.