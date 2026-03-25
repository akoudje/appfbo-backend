#!/usr/bin/env node
// Backfill: corrige les commandes PAID Wave restées en WAITING_PAYMENT.
// Usage:
//   node scripts/backfill-wave-billing-work-status.js          (dry-run)
//   node scripts/backfill-wave-billing-work-status.js --apply  (applique)

const prisma = require("../src/prisma");

function hasApplyFlag(argv) {
  return argv.includes("--apply");
}

async function main() {
  const apply = hasApplyFlag(process.argv.slice(2));

  const impacted = await prisma.preorder.findMany({
    where: {
      status: "PAID",
      paymentStatus: "PAID",
      billingWorkStatus: "WAITING_PAYMENT",
      OR: [
        { paymentProvider: "WAVE" },
        { activePayment: { is: { provider: "WAVE" } } },
        { payments: { some: { provider: "WAVE", status: "SUCCEEDED" } } },
      ],
    },
    select: {
      id: true,
      preorderNumber: true,
      paymentProvider: true,
      paidAt: true,
      billingCompletedAt: true,
      billingWorkStatus: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  console.log(
    `[backfill-wave-billing] impacted orders: ${impacted.length}`,
  );

  if (!impacted.length) {
    return;
  }

  console.log(
    JSON.stringify(
      impacted.map((o) => ({
        id: o.id,
        preorderNumber: o.preorderNumber,
        paymentProvider: o.paymentProvider,
        billingWorkStatus: o.billingWorkStatus,
        paidAt: o.paidAt,
        billingCompletedAt: o.billingCompletedAt,
      })),
      null,
      2,
    ),
  );

  if (!apply) {
    console.log(
      "[backfill-wave-billing] dry-run only. Relance avec --apply pour corriger.",
    );
    return;
  }

  const now = new Date();
  let updatedCount = 0;

  for (const row of impacted) {
    await prisma.$transaction(async (tx) => {
      await tx.preorder.update({
        where: { id: row.id },
        data: {
          billingWorkStatus: "COMPLETED",
          billingCompletedAt: row.billingCompletedAt || row.paidAt || now,
          billingLastActivityAt: now,
          paymentProvider: row.paymentProvider || "WAVE",
        },
      });

      await tx.preorderLog.create({
        data: {
          preorderId: row.id,
          action: "PAYMENT_CONFIRMED",
          note: "Backfill automatique: clôture facturation après paiement Wave",
          actorAdminId: null,
          meta: {
            script: "backfill-wave-billing-work-status",
            previousBillingWorkStatus: "WAITING_PAYMENT",
            newBillingWorkStatus: "COMPLETED",
            executedAt: now.toISOString(),
          },
        },
      });
    });

    updatedCount += 1;
    console.log(
      `[backfill-wave-billing] updated ${updatedCount}/${impacted.length}: ${row.id}`,
    );
  }

  console.log(
    `[backfill-wave-billing] done. updated orders: ${updatedCount}`,
  );
}

main()
  .catch((error) => {
    console.error("[backfill-wave-billing] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

