// Recherche texte multi-colonnes sur Preorder (numéro FBO, nom, référence
// AS400, code de collecte, numéro de précommande, numéro de colis, et deux
// champs relationnels : téléphone payeur / n° de reçu caisse).
//
// Pourquoi ce fichier existe : Postgres refuse de combiner plus de 2-3 index
// trigram différents pour un grand OR et bascule sur un balayage complet de
// la table (mesuré sur Preorder : ~100ms en balayage contre ~3ms par colonne
// via son index — voir commit "perf: fix orders search ignoring its own
// indexes"). On résout donc les ids correspondants via une UNION de
// requêtes mono-colonne (chaque branche garde son propre index), à utiliser
// ensuite comme simple filtre `id: { in: matchedIds }` dans la requête
// Prisma normale (pagination/tri/autres filtres inchangés).
//
// Réutilisé par plusieurs écrans qui recherchent tous sur Preorder (liste
// commandes, espace caisse, rattachement de lien de paiement, commandes
// côté client) — centralisé ici pour ne pas dupliquer le SQL brut.

const prisma = require("../prisma");
const { Prisma } = require("@prisma/client");

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatFboDigits(value) {
  const digits = digitsOnly(value);
  if (digits.length <= 3) return digits;
  return digits.match(/.{1,3}/g).join("-");
}

function buildFboSearchTerms(value) {
  const raw = String(value || "").trim();
  const formatted = formatFboDigits(raw);
  return Array.from(new Set([raw, formatted].filter(Boolean)));
}

/**
 * @param {string} q - terme recherché, tel que saisi par l'utilisateur.
 * @param {Prisma.Sql} scopeSql - fragment SQL de périmètre (ex. `"countryId" = ${id}`),
 *   AND-é dans chaque branche ; porte l'autorisation/l'isolement, donc jamais optionnel.
 * @param {number} [limit] - nombre maximum d'ids retournés (défaut 300).
 */
async function resolveOrderSearchIds({ q, scopeSql, limit = 300 }) {
  const qs = String(q || "").trim();
  if (!qs) return null;
  if (!scopeSql) throw new Error("resolveOrderSearchIds: scopeSql requis");

  const pattern = `%${qs}%`;
  const fboTerms = buildFboSearchTerms(qs);
  const fboPattern1 = `%${fboTerms[0]}%`;
  const fboPattern2 = fboTerms[1] ? `%${fboTerms[1]}%` : fboPattern1;

  const rows = await prisma.$queryRaw`
    SELECT id FROM (
      SELECT id FROM "Preorder"
        WHERE ${scopeSql} AND ("fboNumero" ILIKE ${fboPattern1} OR "fboNumero" ILIKE ${fboPattern2})
      UNION
      SELECT id FROM "Preorder" WHERE ${scopeSql} AND "fboNomComplet" ILIKE ${pattern}
      UNION
      SELECT id FROM "Preorder" WHERE ${scopeSql} AND "factureReference" ILIKE ${pattern}
      UNION
      SELECT id FROM "Preorder" WHERE ${scopeSql} AND "paymentCollectionCode" ILIKE ${pattern}
      UNION
      SELECT id FROM "Preorder" WHERE ${scopeSql} AND "preorderNumber" ILIKE ${pattern}
      UNION
      SELECT id FROM "Preorder" WHERE ${scopeSql} AND "parcelNumber" ILIKE ${pattern}
      UNION
      SELECT id FROM "Preorder" WHERE ${scopeSql}
        AND EXISTS (
          SELECT 1 FROM "PaymentAttempt" pa
          WHERE pa."paymentId" = "Preorder"."activePaymentId" AND pa."providerPayerPhone" ILIKE ${pattern}
        )
      UNION
      SELECT id FROM "Preorder" WHERE ${scopeSql}
        AND EXISTS (
          SELECT 1 FROM "CashierTransaction" ct
          WHERE ct."preorderId" = "Preorder".id AND ct."receiptNumber" ILIKE ${pattern}
        )
    ) matched
    LIMIT ${limit}
  `;

  return rows.map((row) => row.id);
}

module.exports = {
  digitsOnly,
  formatFboDigits,
  buildFboSearchTerms,
  resolveOrderSearchIds,
};
