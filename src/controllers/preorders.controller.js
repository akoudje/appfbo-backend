// preorders.controller.js : implémente la logique métier des précommandes, avec 4 fonctions principales : createDraft (étape 1), setItems (étape 2), getSummary (étape 3) et submit (validation finale). Utilise Prisma pour les opérations DB, et des services pour le calcul des totaux et la génération du message WhatsApp.
const prisma = require("../prisma");
const { computePreorderTotals } = require("../services/pricing.service");
const { buildWhatsAppMessage, buildWhatsAppLink } = require("../services/whatsapp.service");
const { scopeWhere, scopeCreate } = require("../helpers/countryScope");

// Numéros facturation (tu pourras mettre ça en DB/config plus tard)
const BILLING_WHATSAPPS = [
  process.env.BILLING_WA_1 || "+2250506025071",
];

// ETAPE 1: créer draft
async function createDraft(req, res) {
  const {
    numeroFbo,
    nomComplet,
    grade,
    pointDeVente,
    paymentMode,
    deliveryMode,
  } = req.body;

  if (!numeroFbo || !nomComplet || !grade || !pointDeVente || !paymentMode || !deliveryMode) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  // upsert FBO
  const fbo = await prisma.fbo.upsert({
    where: { numeroFbo: String(numeroFbo) },
    update: {
      nomComplet: String(nomComplet),
      grade,
      pointDeVente: String(pointDeVente),
    },
    create: {
      numeroFbo: String(numeroFbo),
      nomComplet: String(nomComplet),
      grade,
      pointDeVente: String(pointDeVente),
    },
  });

  const preorder = await prisma.preorder.create({
    data: scopeCreate(req, {
      fboId: fbo.id,
      fboNumero: fbo.numeroFbo,
      fboNomComplet: fbo.nomComplet,
      fboGrade: fbo.grade,
      pointDeVente: fbo.pointDeVente,
      paymentMode,
      deliveryMode,
      status: "DRAFT",
    }),
  });

  res.json({ preorderId: preorder.id });
}

// ETAPE 2: set items (remplace le panier)
async function setItems(req, res) {
  const preorderId = req.params.id;
  const { items } = req.body;
  const countryId = req.country.id;

  if (!Array.isArray(items)) return res.status(400).json({ error: "items must be an array" });

  const preorder = await prisma.preorder.findFirst({
    where: scopeWhere(req, { id: preorderId }),
  });
  if (!preorder) return res.status(404).json({ error: "Preorder not found" });
  if (preorder.status !== "DRAFT") return res.status(400).json({ error: "Preorder not editable" });

  // Normalise items: qty>=0
  const normalized = items
    .map((it) => ({
      productId: String(it.productId),
      qty: Math.max(parseInt(it.qty || 0, 10), 0),
    }))
    .filter((it) => it.productId && it.qty > 0);

  if (normalized.length) {
    const productIds = [...new Set(normalized.map((it) => it.productId))];
    const products = await prisma.product.findMany({
      where: scopeWhere(req, { id: { in: productIds }, actif: true }),
      select: { id: true },
    });
    if (products.length !== productIds.length) {
      return res.status(400).json({
        error: "Certains produits sont invalides pour le pays courant",
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    // Supprime tout, puis recrée (simple MVP)
    await tx.preorderItem.deleteMany({ where: { preorderId } });

    if (normalized.length) {
      // Crée avec placeholders, recalcul ensuite
      await tx.preorderItem.createMany({
        data: normalized.map((it) => ({
          preorderId,
          productId: it.productId,
          qty: it.qty,
          // placeholders (seront fixés au submit)
          prixUnitaireFcfa: 0,
          ccUnitaire: "0.000",
          poidsUnitaireKg: "0.000",
          lineTotalFcfa: 0,
          lineTotalCc: "0.000",
          lineTotalPoids: "0.000",
        })),
      });
    }
  });

  const summary = await computePreorderTotals(preorderId, countryId);
  res.json({
    preorderId,
    items: summary.items,
    totals: summary.totals,
  });
}

// ETAPE 3: summary (récap avant validation)
async function getSummary(req, res) {
  const preorderId = req.params.id;
  const countryId = req.country.id;

  try {
    const summary = await computePreorderTotals(preorderId, countryId);
    res.json({
      preorderId,
      discountPercent: summary.discountPercent,
      items: summary.items,
      totals: summary.totals,
      billingWhatsapps: BILLING_WHATSAPPS,
    });
  } catch (e) {
    if (
      String(e.message) === "PREORDER_NOT_FOUND" ||
      String(e.message) === "PRODUCT_COUNTRY_MISMATCH"
    ) {
      return res.status(404).json({ error: "Preorder not found" });
    }
    throw e;
  }
}

// SUBMIT: fige lignes + totaux + message WhatsApp + statut SUBMITTED + décrémente stock
async function submit(req, res) {
  const preorderId = req.params.id;
  const { whatsappTo } = req.body || {};
  const countryId = req.country.id;

  const preorder = await prisma.preorder.findFirst({
    where: scopeWhere(req, { id: preorderId }),
    include: { items: { include: { product: true } } },
  });
  if (!preorder) return res.status(404).json({ error: "Preorder not found" });
  if (preorder.status !== "DRAFT")
    return res.status(400).json({ error: "Preorder not editable" });

  // ✅ Bloque commande vide
  if (!preorder.items || preorder.items.length === 0) {
    return res.status(400).json({ error: "Panier vide. Ajoute au moins 1 article." });
  }

  const summary = await computePreorderTotals(preorderId, countryId);

  // ✅ Re-bloque si compute renvoie vide (double sécurité)
  if (!summary.items || summary.items.length === 0) {
    return res.status(400).json({ error: "Panier vide. Ajoute au moins 1 article." });
  }

  const message = buildWhatsAppMessage({
    preorder: summary.preorder,
    items: summary.items,
    totals: summary.totals,
  });

  const chosen = whatsappTo || BILLING_WHATSAPPS[0];
  const links = BILLING_WHATSAPPS.map((p) => ({
    phone: p,
    link: buildWhatsAppLink(p, message),
  }));

  try {
    await prisma.$transaction(async (tx) => {
      // ✅ 1) Décrément stock (atomique) + check stock
      for (const it of summary.items) {
        const updated = await tx.product.updateMany({
          where: {
            id: it.productId,
            countryId,          // sécurité multi-pays
            actif: true,
            stockQty: { gte: it.qty },
          },
          data: { stockQty: { decrement: it.qty } },
        });

        if (updated.count !== 1) {
          const err = new Error(`Stock insuffisant pour le produit: ${it.nom || it.productId}`);
          err.statusCode = 409;
          throw err;
        }
      }

      // ✅ 2) fige items (prix/cc/poids)
      for (const it of summary.items) {
        await tx.preorderItem.update({
          where: {
            preorderId_productId: { preorderId, productId: it.productId },
          },
          data: {
            prixUnitaireFcfa: it.prixUnitaireFcfa,
            ccUnitaire: String(it.ccUnitaire.toFixed(3)),
            poidsUnitaireKg: String(it.poidsUnitaireKg.toFixed(3)),
            lineTotalFcfa: it.lineTotalFcfa,
            lineTotalCc: String(Number(it.lineTotalCc).toFixed(3)),
            lineTotalPoids: String(Number(it.lineTotalPoids).toFixed(3)),
          },
        });
      }

      // ✅ 3) update preorder
      await tx.preorder.update({
        where: { id: preorderId },
        data: {
          status: "SUBMITTED",
          totalCc: String(summary.totals.totalCc.toFixed(3)),
          totalPoidsKg: String(summary.totals.totalPoidsKg.toFixed(3)),
          totalProduitsFcfa: summary.totals.totalProduitsFcfa,
          fraisLivraisonFcfa: summary.totals.fraisLivraisonFcfa,
          totalFcfa: summary.totals.totalFcfa,
          whatsappMessage: message,
          factureWhatsappTo: chosen,
          submittedAt: new Date(),
        },
      });
    });

    return res.json({
      preorderId,
      status: "SUBMITTED",
      totals: summary.totals,
      whatsappMessage: message,
      billing: links,
    });
  } catch (e) {
    const status = e.statusCode || 500;
    return res.status(status).json({ error: e.message || "Erreur submit" });
  }
}

module.exports = {
  createDraft,
  setItems,
  getSummary,
  submit,
};
