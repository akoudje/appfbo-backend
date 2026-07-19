require("dotenv").config();

const prisma = require("../src/prisma");
const {
  cancelExpiredInvoicedPreorders,
} = require("../src/services/preorder-expiration.service");

// Lecture seule : recense les commandes INVOICED/PAYMENT_PENDING impayées
// dont le délai d'auto-annulation est dépassé mais qui sont exclues par une
// des règles de protection (SMS en échec, preuve bancaire en attente, etc.).
async function main() {
  const now = new Date();

  const eligibleForCancel = await cancelExpiredInvoicedPreorders({
    now,
    dryRun: true,
  });

  const allOverdue = await prisma.preorder.findMany({
    where: {
      status: { in: ["INVOICED", "PAYMENT_PENDING"] },
      paymentStatus: { not: "PAID" },
      cancelledAt: null,
      invoicedAt: { not: null },
    },
    select: {
      id: true,
      preorderNumber: true,
      fboNomComplet: true,
      fboNumero: true,
      status: true,
      paymentStatus: true,
      preorderPaymentMode: true,
      bankPaymentStatus: true,
      lastWhatsappStatus: true,
      lastWhatsappStatusAt: true,
      invoicedAt: true,
      paymentExpiresAt: true,
      country: { select: { code: true } },
    },
    orderBy: [{ invoicedAt: "asc" }],
  });

  const eligibleIds = new Set(
    (eligibleForCancel?.cancelled || []).map((row) => row.id),
  );

  const stuck = allOverdue.filter((order) => {
    if (eligibleIds.has(order.id)) return false; // ce serait annulé au prochain tick
    const expiryAt = order.paymentExpiresAt
      ? new Date(order.paymentExpiresAt)
      : null;
    if (!expiryAt || Number.isNaN(expiryAt.getTime())) return false;
    return now.getTime() >= expiryAt.getTime();
  });

  const reasons = stuck.map((order) => {
    let reason = "AUTRE";
    if (String(order.lastWhatsappStatus || "").toUpperCase() === "FAILED") {
      reason = "SMS_FAILED";
    } else if (
      ["BANK_TRANSFER", "ECOBANK_PAY", "PI_SPI"].includes(
        String(order.preorderPaymentMode || "").toUpperCase(),
      ) &&
      ["PROOF_SUBMITTED", "UNDER_REVIEW", "APPROVED"].includes(
        String(order.bankPaymentStatus || "").toUpperCase(),
      )
    ) {
      reason = "PREUVE_BANCAIRE_EN_ATTENTE";
    }
    return { ...order, reason };
  });

  const byReason = reasons.reduce((acc, o) => {
    acc[o.reason] = (acc[o.reason] || 0) + 1;
    return acc;
  }, {});

  console.log("=== Résumé ===");
  console.log(`Commandes en retard total (candidates au check): ${allOverdue.length}`);
  console.log(`Auto-annulables au prochain tick: ${eligibleForCancel?.cancelledCount ?? 0}`);
  console.log(`Bloquées (ni annulées ni annulables): ${stuck.length}`);
  console.log("Répartition par cause:", byReason);
  console.log("");
  console.log("=== Détail des commandes bloquées ===");
  for (const o of reasons) {
    console.log(
      [
        o.preorderNumber,
        o.country?.code || "-",
        o.status,
        o.preorderPaymentMode || "-",
        `SMS:${o.lastWhatsappStatus || "-"}`,
        `Banque:${o.bankPaymentStatus || "-"}`,
        `Facturée:${o.invoicedAt ? new Date(o.invoicedAt).toISOString() : "-"}`,
        `Raison:${o.reason}`,
        o.fboNomComplet,
      ].join(" | "),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[diagnose-stuck-preinvoiced] failed", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
