require("dotenv").config();

const prisma = require("../src/prisma");

function hasFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  const apply = hasFlag("--apply");
  const countryCodeArg = process.argv.find((arg) => arg.startsWith("--country="));
  const countryCode = countryCodeArg ? countryCodeArg.split("=").slice(1).join("=").trim().toUpperCase() : "";

  const country = countryCode
    ? await prisma.country.findUnique({
        where: { code: countryCode },
        select: { id: true, code: true, name: true },
      })
    : null;

  if (countryCode && !country) {
    throw new Error(`Pays introuvable: ${countryCode}`);
  }

  const rows = await prisma.preorder.findMany({
    where: {
      status: "SUBMITTED",
      ...(country ? { countryId: country.id } : {}),
      items: { none: {} },
    },
    select: {
      id: true,
      preorderNumber: true,
      fboNumero: true,
      fboNomComplet: true,
      totalFcfa: true,
      country: { select: { code: true, name: true } },
      createdAt: true,
      submittedAt: true,
    },
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
  });

  console.log(
    JSON.stringify(
      {
        apply,
        country: country ? country.code : "ALL",
        count: rows.length,
        orders: rows,
      },
      null,
      2,
    ),
  );

  if (!apply || rows.length === 0) return;

  const now = new Date();
  for (const order of rows) {
    await prisma.$transaction(async (tx) => {
      await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "DRAFT",
          paymentStatus: "UNPAID",
          billingWorkStatus: "NONE",
          billingQueueEnteredAt: null,
          billingSlaDeadlineAt: null,
          submittedAt: null,
        },
      });

      await tx.preorderLog.create({
        data: {
          preorderId: order.id,
          action: "REPAIR_EMPTY_SUBMITTED",
          note: "Correction automatique : commande soumise sans article remise en brouillon.",
          meta: {
            previousStatus: "SUBMITTED",
            repairedAt: now.toISOString(),
            script: "audit-empty-submitted-orders",
          },
        },
      });
    });
  }

  console.log(`[audit-empty-submitted-orders] ${rows.length} commande(s) réparée(s).`);
}

main()
  .catch((error) => {
    console.error("[audit-empty-submitted-orders] erreur:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
