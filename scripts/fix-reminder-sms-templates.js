/**
 * Corrige les templates SMS REMINDER qui contiennent un préfixe "FOREVER:" intégré,
 * causant une triple référence de commande et un lien de paiement manquant.
 *
 * Usage: node backend/scripts/fix-reminder-sms-templates.js
 */

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const FIXES = [
  {
    countryId: "cmmow7yji000012bfrzsq3mc4",
    oldReminder: "FOREVER: Rappel commande {{preorderNumber}}. Ref: {{invoiceRef}}. Paiement: {{paymentLink}}",
    newReminder: "Rappel commande {{preorderNumber}}. Montant {{totalFcfaLabel}}. Paiement Wave: {{paymentLink}}",
  },
  {
    countryId: "cmmow810h000d12bfk5cqgpi6",
    oldReminder: "FOREVER: Rappel commande {{preorderNumber}}. Code {{paymentCollectionCode}}. Montant {{totalFcfa}}F. Assistance: {{supportPhone}}",
    newReminder: "Rappel commande {{preorderNumber}}. Code {{paymentCollectionCode}}. Montant {{totalFcfaLabel}}. Assistance: {{supportPhone}}",
  },
];

async function main() {
  let fixedCount = 0;

  for (const fix of FIXES) {
    const row = await prisma.countrySettings.findFirst({
      where: { countryId: fix.countryId },
      select: { countryId: true, notificationTemplates: true },
    });

    if (!row) {
      console.log(`[SKIP] Pays ${fix.countryId} introuvable.`);
      continue;
    }

    const current = String(row.notificationTemplates?.sms?.REMINDER || "").trim();
    if (current !== fix.oldReminder) {
      console.log(`[SKIP] ${fix.countryId} — template différent de l'attendu :`);
      console.log(`  Actuel  : ${current}`);
      console.log(`  Attendu : ${fix.oldReminder}`);
      continue;
    }

    const updatedTemplates = {
      ...row.notificationTemplates,
      sms: {
        ...(row.notificationTemplates?.sms || {}),
        REMINDER: fix.newReminder,
      },
    };

    await prisma.countrySettings.update({
      where: { countryId: fix.countryId },
      data: { notificationTemplates: updatedTemplates },
    });

    console.log(`[OK] ${fix.countryId} — template REMINDER corrigé.`);
    console.log(`  Avant : ${fix.oldReminder}`);
    console.log(`  Après : ${fix.newReminder}`);
    fixedCount++;
  }

  console.log(`\n${fixedCount}/${FIXES.length} pays mis à jour.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
