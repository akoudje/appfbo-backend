-- Empêche toute nouvelle facture de réutiliser une référence AS400 déjà utilisée
-- (par pays, insensible à la casse et aux espaces).
--
-- Portée volontairement limitée aux commandes créées à partir du 2026-07-21 :
-- 126 commandes plus anciennes partagent déjà 58 références en doublon et ne
-- peuvent pas satisfaire une contrainte totale sans nettoyage manuel préalable.
-- Le contrôle applicatif (orders.controller.js) bloque déjà, lui, tous les cas
-- sans limite de date ; cet index est le filet de sécurité en base pour tout
-- ce qui est créé après la mise en place de ce blocage.
CREATE UNIQUE INDEX "Preorder_factureReference_country_ci_key"
ON "Preorder" (
  "countryId",
  LOWER(TRIM("factureReference"))
)
WHERE "factureReference" IS NOT NULL
  AND TRIM("factureReference") <> ''
  AND "createdAt" >= '2026-07-21T00:00:00Z';
