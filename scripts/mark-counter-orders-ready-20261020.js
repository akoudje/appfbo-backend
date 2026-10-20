// Marque comme PRETES (READY) les 13 commandes payées au comptoir le
// 2026-10-20 (voir scripts/mark-counter-cash-payments-20261020.js) en
// rejouant la vraie chaîne caisse -> préparation, en process, pour garder
// la cohérence des effets réels (décompte de stock, StockMovement,
// checklist de préparation, numéro de colis, code de retrait, SMS client).
//
// Usage: node scripts/mark-counter-orders-ready-20261020.js

const prisma = require("../src/prisma");

// Le timeout par défaut (5s) de Prisma pour une transaction interactive est
// trop court ici : launchPreparation/prepareOrder font plusieurs requêtes
// séquentielles par ligne de commande dans une seule transaction, et la
// latence réseau vers la base de prod (hors du datacenter) peut dépasser ce
// délai. On relève le timeout uniquement pour ce script (process séparé),
// sans toucher à la config partagée.
const originalTransaction = prisma.$transaction.bind(prisma);
prisma.$transaction = (fn, options) =>
  originalTransaction(fn, { timeout: 20000, maxWait: 20000, ...options });

const { launchPreparation } = require("../src/controllers/admin/cashier.controller");
const {
  bulkUpdatePreparationChecklist,
  prepareOrder,
} = require("../src/controllers/admin/orders.controller");

const ORDER_NUMBERS = [
  "PO-CIV-20261020-0235",
  "PO-CIV-20261020-0233",
  "PO-CIV-20261020-0232",
  "PO-CIV-20261020-0231",
  "PO-CIV-20261020-0230",
  "PO-CIV-20261020-0229",
  "PO-CIV-20261020-0227",
  "PO-CIV-20261020-0226",
  "PO-CIV-20261020-0224",
  "PO-CIV-20261020-0222",
  "PO-CIV-20261020-0221",
  "PO-CIV-20261020-0219",
  "PO-CIV-20261020-0218",
];

function fakeRes(label) {
  return {
    _status: 200,
    status(code) {
      this._status = code;
      return this;
    },
    json(payload) {
      if (this._status >= 400) {
        console.error(`[ERREUR ${this._status}] ${label}:`, payload?.message || payload);
      } else {
        console.log(`[OK] ${label} ->`, payload?.status || payload?.order?.status || "ok");
      }
      return payload;
    },
  };
}

async function run() {
  for (const preorderNumber of ORDER_NUMBERS) {
    const order = await prisma.preorder.findUnique({
      where: { preorderNumber },
      include: { assignedInvoicer: true },
    });

    if (!order) {
      console.error(`[SKIP] ${preorderNumber} introuvable`);
      continue;
    }
    if (order.status !== "PAID" || order.paymentStatus !== "PAID") {
      console.error(`[SKIP] ${preorderNumber} statut inattendu (${order.status}/${order.paymentStatus})`);
      continue;
    }

    const actor = order.assignedInvoicer;
    const user = actor
      ? { id: actor.id, fullName: actor.fullName, email: actor.email, role: actor.role }
      : { id: null, fullName: "Caisse", email: null, role: "CAISSIERE" };

    const baseReq = {
      params: { id: order.id },
      body: {},
      user,
      countryId: order.countryId,
    };

    await launchPreparation(baseReq, fakeRes(`${preorderNumber} launchPreparation`));

    await bulkUpdatePreparationChecklist(
      { ...baseReq, body: { checked: true } },
      fakeRes(`${preorderNumber} bulkUpdatePreparationChecklist`),
    );

    await prepareOrder(baseReq, fakeRes(`${preorderNumber} prepareOrder`));
  }

  const final = await prisma.preorder.findMany({
    where: { preorderNumber: { in: ORDER_NUMBERS } },
    select: {
      preorderNumber: true,
      status: true,
      parcelNumber: true,
      pickupSecretCode: true,
      preparedAt: true,
      stockDeductedAt: true,
    },
    orderBy: { preorderNumber: "asc" },
  });
  console.log("\n--- État final ---");
  for (const o of final) {
    console.log(
      o.preorderNumber,
      o.status,
      "colis:" + o.parcelNumber,
      "code:" + o.pickupSecretCode,
      "préparé:" + !!o.preparedAt,
      "stock décompté:" + !!o.stockDeductedAt,
    );
  }

  await prisma.$disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
