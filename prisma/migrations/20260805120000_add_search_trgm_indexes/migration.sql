-- Index trigram (pg_trgm) pour accélérer les recherches "contains" (LIKE %terme%)
-- utilisées par la file du facturier (admin/orders.controller.js buildOrdersListWhere)
-- et l'espace caisse (admin/cashier.controller.js getWorkspace). Un index B-tree
-- classique n'accélère pas ce type de filtre : sans index adapté, chaque recherche
-- forçait un scan complet des tables concernées.
--
-- Non modélisé dans schema.prisma (type d'index GIN + opérateur gin_trgm_ops non
-- supportés sans activer le preview feature postgresqlExtensions) — même
-- convention que l'index partiel de la migration 20260721000000_as400_reference_unique_going_forward.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Preorder_fboNumero_trgm_idx" ON "Preorder" USING GIN ("fboNumero" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Preorder_fboNomComplet_trgm_idx" ON "Preorder" USING GIN ("fboNomComplet" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Preorder_factureReference_trgm_idx" ON "Preorder" USING GIN ("factureReference" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Preorder_paymentCollectionCode_trgm_idx" ON "Preorder" USING GIN ("paymentCollectionCode" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Preorder_preorderNumber_trgm_idx" ON "Preorder" USING GIN ("preorderNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Preorder_parcelNumber_trgm_idx" ON "Preorder" USING GIN ("parcelNumber" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "PaymentAttempt_providerPayerPhone_trgm_idx" ON "PaymentAttempt" USING GIN ("providerPayerPhone" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "CashierTransaction_receiptNumber_trgm_idx" ON "CashierTransaction" USING GIN ("receiptNumber" gin_trgm_ops);
