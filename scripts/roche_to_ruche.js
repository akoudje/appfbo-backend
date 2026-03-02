/**
 * Migration data: Product.category = PRODUIT_DE_LA_ROCHE  ->  PRODUIT_DE_LA_RUCHE
 *
 * Usage (recommended):
 *   # 1) DRY RUN (no write)
 *   node scripts/roche_to_ruche.js
 *
 *   # 2) APPLY (writes)
 *   node scripts/roche_to_ruche.js --apply
 *
 * Notes:
 * - Requires DATABASE_URL to point to the target DB (prod Render or local)
 * - Safe to run multiple times
 */

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const FROM = "PRODUIT_DE_LA_ROCHE";
const TO = "PRODUIT_DE_LA_RUCHE";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : null;

  console.log("=== roche_to_ruche ===");
  console.log("Mode:", apply ? "APPLY (write)" : "DRY RUN (read-only)");
  if (limit) console.log("Limit:", limit);

  // 1) Count how many rows are concerned
  const total = await prisma.product.count({
    where: { category: FROM },
  });

  console.log(`Products with category=${FROM}:`, total);

  if (total === 0) {
    console.log("Nothing to do ✅");
    return;
  }

  // 2) Show a preview (first 20)
  const preview = await prisma.product.findMany({
    where: { category: FROM },
    select: { id: true, sku: true, nom: true, category: true },
    take: 20,
    orderBy: { createdAt: "desc" },
  });

  console.log("Preview (up to 20):");
  for (const p of preview) {
    console.log(`- ${p.id} | ${p.sku} | ${p.nom} | ${p.category}`);
  }

  if (!apply) {
    console.log("\nDry-run terminé. Relance avec --apply pour appliquer ✅");
    return;
  }

  // 3) Apply update
  // Optional: apply in one shot, or chunk if you prefer.
  if (!limit) {
    const res = await prisma.product.updateMany({
      where: { category: FROM },
      data: { category: TO },
    });
    console.log(`Updated rows: ${res.count} ✅`);
  } else {
    // Chunked (limit) mode: update only N rows, useful for cautious rollout
    const ids = await prisma.product.findMany({
      where: { category: FROM },
      select: { id: true },
      take: limit,
      orderBy: { createdAt: "desc" },
    });

    const idList = ids.map((x) => x.id);
    const res = await prisma.product.updateMany({
      where: { id: { in: idList } },
      data: { category: TO },
    });
    console.log(`Updated rows (limited): ${res.count} ✅`);
  }

  // 4) Recount
  const remaining = await prisma.product.count({
    where: { category: FROM },
  });
  console.log(`Remaining with category=${FROM}:`, remaining);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });