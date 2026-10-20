/**
 * Supprime les précommandes de test créées pour valider le workflow du rôle
 * Facturier caissier (voir create-test-preorders-facturier-caissier.js).
 * Filtre strictement sur isTest=true : ne touche à rien d'autre.
 *
 * Usage: node backend/scripts/delete-test-preorders-facturier-caissier.js
 */

const prisma = require("../src/prisma");

async function main() {
  const orders = await prisma.preorder.findMany({
    where: { isTest: true },
    select: { id: true, preorderNumber: true },
  });

  if (!orders.length) {
    console.log("Aucune précommande de test (isTest=true) à supprimer.");
    return;
  }

  const result = await prisma.preorder.deleteMany({
    where: { isTest: true },
  });

  console.log(`Supprimé ${result.count} précommande(s) de test :`);
  for (const order of orders) {
    console.log(`  - ${order.preorderNumber}`);
  }
}

main()
  .catch((error) => {
    console.error("[ERREUR]", error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
