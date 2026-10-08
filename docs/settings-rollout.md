# Déploiement de la page Paramètres

Cette évolution ajoute la table CountrySettingsChange pour conserver l’auteur et les valeurs avant/après de chaque modification. Les droits de lecture et d’écriture restent inchangés.

Avant de démarrer le nouveau backend, exécuter dans son environnement habituel :

```sh
npx prisma migrate deploy
npx prisma generate
```

Migration ajoutée : 20261006120000_country_settings_history. La migration et le client Prisma doivent être disponibles avant d’activer les nouvelles sauvegardes : une écriture et son historique sont enregistrés dans la même transaction.

Déployer ensuite le backend et l’administration ensemble. Aucun historique ancien n’est reconstitué. La page affiche les 30 derniers changements par pays.

Le frontend transmet uniquement les champs modifiés et expectedUpdatedAt (date ISO de la version chargée, ou null pour une configuration initiale). Une version différente retourne 409 et conserve le brouillon à l’écran. L’utilisateur doit recharger explicitement les valeurs enregistrées avant de réappliquer ses modifications.

Les préférences sonores restent stockées sur le navigateur, séparément pour facturation, caisse et préparation. La disponibilité publique d’un pays est une action immédiate, confirmée séparément, réservée au super administrateur.

Validation locale effectuée : tests de modèle et de concurrence, validation Prisma, lint, build Vite, et parcours navigateur avec des données fictives (sauvegarde partielle, pays ciblé, confirmation, erreur de chargement et largeur mobile 390 px).