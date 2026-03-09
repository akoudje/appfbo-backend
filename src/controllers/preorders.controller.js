// src/controllers/preorders.controller.js
// Ce controller gère le processus de précommande en 4 étapes :
// 1) createDraft : création du brouillon de précommande avec les infos FBO + mode paiement/livraison
// 2) setItems : définition du panier (remplace le panier précédent)
// 3) getSummary : récapitulatif de la précommande avant validation (calcul des totaux, message WhatsApp, etc.)
// 4) submit : validation finale qui fige les totaux, génère le message WhatsApp, change le statut en SUBMITTED


const prisma = require("../prisma");
const { computePreorderTotals } = require("../services/pricing.service");
const {
  buildWhatsAppMessage,
  buildWhatsAppLink,
} = require("../services/whatsapp.service");
const { scopeWhere, scopeCreate } = require("../helpers/countryScope");

const BILLING_WHATSAPPS = [process.env.BILLING_WA_1 || "+2250506025071"];

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizeNumeroFbo(v) {
  return String(v || "").trim();
}

// ETAPE 1: créer draft
async function createDraft(req, res) {
  try {
    const {
      numeroFbo,
      nomComplet,
      grade,
      pointDeVente,
      paymentMode = null,
      deliveryMode = null,
    } = req.body || {};

    if (
      !isNonEmptyString(numeroFbo) ||
      !isNonEmptyString(nomComplet) ||
      !isNonEmptyString(pointDeVente) ||
      !grade
    ) {
      return res.status(400).json({
        error: "numeroFbo, nomComplet, grade et pointDeVente sont requis",
      });
    }

    const normalizedNumeroFbo = normalizeNumeroFbo(numeroFbo);

    const fbo = await prisma.fbo.upsert({
      where: { numeroFbo: normalizedNumeroFbo },
      update: {
        nomComplet: String(nomComplet).trim(),
        grade,
        pointDeVente: String(pointDeVente).trim(),
      },
      create: {
        numeroFbo: normalizedNumeroFbo,
        nomComplet: String(nomComplet).trim(),
        grade,
        pointDeVente: String(pointDeVente).trim(),
      },
    });

    const preorder = await prisma.$transaction(async (tx) => {
      const created = await tx.preorder.create({
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

      await tx.preorderLog.create({
        data: {
          preorderId: created.id,
          action: "CREATE_DRAFT",
          note: "Brouillon créé",
          meta: {
            fboId: fbo.id,
            numeroFbo: fbo.numeroFbo,
            paymentMode,
            deliveryMode,
          },
        },
      });

      return created;
    });

    return res.json({ preorderId: preorder.id, status: preorder.status });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Erreur createDraft" });
  }
}

// ETAPE 2: set items (remplace le panier)
async function setItems(req, res) {
  try {
    const preorderId = req.params.id;
    const { items } = req.body || {};
    const countryId = req.country.id;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: "items must be an array" });
    }

    const preorder = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id: preorderId }),
    });

    if (!preorder) {
      return res.status(404).json({ error: "Preorder not found" });
    }

    if (preorder.status !== "DRAFT") {
      return res.status(400).json({ error: "Preorder not editable" });
    }

    const normalized = items
      .map((it) => ({
        productId: String(it.productId || "").trim(),
        qty: Math.max(parseInt(it.qty || 0, 10), 0),
      }))
      .filter((it) => it.productId && it.qty > 0);

    const productIds = [...new Set(normalized.map((it) => it.productId))];

    if (productIds.length > 0) {
      const products = await prisma.product.findMany({
        where: scopeWhere(req, {
          id: { in: productIds },
          actif: true,
        }),
        select: { id: true },
      });

      if (products.length !== productIds.length) {
        return res.status(400).json({
          error: "Certains produits sont invalides pour le pays courant",
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.preorderItem.deleteMany({ where: { preorderId } });

      if (normalized.length > 0) {
        await tx.preorderItem.createMany({
          data: normalized.map((it) => ({
            preorderId,
            productId: it.productId,
            qty: it.qty,

            productSkuSnapshot: null,
            productNameSnapshot: null,

            prixCatalogueFcfa: 0,
            discountPercent: "0.00",
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

    await prisma.$transaction(async (tx) => {
      await tx.preorder.update({
        where: { id: preorderId },
        data: {
          totalCc: String(Number(summary.totals.totalCc || 0).toFixed(3)),
          totalPoidsKg: String(
            Number(summary.totals.totalPoidsKg || 0).toFixed(3)
          ),
          totalProduitsFcfa: summary.totals.totalProduitsFcfa || 0,
          fraisLivraisonFcfa: summary.totals.fraisLivraisonFcfa || 0,
          totalFcfa: summary.totals.totalFcfa || 0,
        },
      });

      await tx.preorderLog.create({
        data: {
          preorderId,
          action: "SET_ITEMS",
          note: "Panier mis à jour",
          meta: {
            itemsCount: summary.items.length,
            totalFcfa: summary.totals.totalFcfa || 0,
          },
        },
      });
    });

    return res.json({
      preorderId,
      items: summary.items,
      totals: summary.totals,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Erreur setItems" });
  }
}

// ETAPE 3: summary (récap avant validation)
async function getSummary(req, res) {
  const preorderId = req.params.id;
  const countryId = req.country.id;

  try {
    const summary = await computePreorderTotals(preorderId, countryId);

    return res.json({
      preorderId,
      discountPercent: summary.discountPercent,
      items: summary.items,
      totals: summary.totals,
      billingWhatsapps: BILLING_WHATSAPPS,
    });
  } catch (e) {
    if (String(e.message) === "PREORDER_NOT_FOUND") {
      return res.status(404).json({ error: "Preorder not found" });
    }

    if (
      [
        "PRODUCT_COUNTRY_MISMATCH",
        "PRODUCT_NOT_FOUND",
        "PRODUCT_INACTIVE",
      ].includes(String(e.message))
    ) {
      return res.status(400).json({
        error: "Un ou plusieurs produits du panier sont invalides.",
      });
    }

    return res.status(500).json({ error: e.message || "Erreur getSummary" });
  }
}

// SUBMIT: fige lignes + totaux + message WhatsApp + statut SUBMITTED
// IMPORTANT: NE DECREMENTE PAS LE STOCK ICI
async function submit(req, res) {
  const preorderId = req.params.id;
  const { whatsappTo } = req.body || {};
  const countryId = req.country.id;

  try {
    const preorder = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id: preorderId }),
      include: {
        items: { include: { product: true } },
        country: { include: { settings: true } },
      },
    });

    if (!preorder) {
      return res.status(404).json({ error: "Preorder not found" });
    }

    if (preorder.status !== "DRAFT") {
      return res.status(400).json({ error: "Preorder not editable" });
    }

    if (!preorder.items || preorder.items.length === 0) {
      return res
        .status(400)
        .json({ error: "Panier vide. Ajoute au moins 1 article." });
    }

    if (!preorder.paymentMode) {
      return res
        .status(400)
        .json({ error: "Le mode de paiement est obligatoire." });
    }

    if (!preorder.deliveryMode) {
      return res
        .status(400)
        .json({ error: "Le mode de livraison est obligatoire." });
    }

    if (!isNonEmptyString(preorder.fboNumero) || !preorder.fboGrade) {
      return res
        .status(400)
        .json({ error: "Les informations FBO sont incomplètes." });
    }

    const summary = await computePreorderTotals(preorderId, countryId);

    if (!summary.items || summary.items.length === 0) {
      return res
        .status(400)
        .json({ error: "Panier vide. Ajoute au moins 1 article." });
    }

    const minCartFcfa = preorder.country?.settings?.minCartFcfa || 0;
    if ((summary.totals.totalFcfa || 0) < minCartFcfa) {
      return res.status(400).json({
        error: `Montant minimum non atteint. Minimum requis: ${minCartFcfa} FCFA.`,
      });
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

    await prisma.$transaction(async (tx) => {
      for (const it of summary.items) {
        await tx.preorderItem.update({
          where: {
            preorderId_productId: {
              preorderId,
              productId: it.productId,
            },
          },
          data: {
            productSkuSnapshot: it.sku || null,
            productNameSnapshot: it.nom || null,

            prixCatalogueFcfa:
              it.prixCatalogueFcfa != null
                ? it.prixCatalogueFcfa
                : it.prixUnitaireFcfa,

            discountPercent: String(
              Number(it.discountPercent != null ? it.discountPercent : 0).toFixed(
                2
              )
            ),

            prixUnitaireFcfa: it.prixUnitaireFcfa,

            ccUnitaire: String(Number(it.ccUnitaire || 0).toFixed(3)),
            poidsUnitaireKg: String(Number(it.poidsUnitaireKg || 0).toFixed(3)),

            lineTotalFcfa: it.lineTotalFcfa,
            lineTotalCc: String(Number(it.lineTotalCc || 0).toFixed(3)),
            lineTotalPoids: String(Number(it.lineTotalPoids || 0).toFixed(3)),
          },
        });
      }

      await tx.preorder.update({
        where: { id: preorderId },
        data: {
          status: "SUBMITTED",
          totalCc: String(Number(summary.totals.totalCc || 0).toFixed(3)),
          totalPoidsKg: String(
            Number(summary.totals.totalPoidsKg || 0).toFixed(3)
          ),
          totalProduitsFcfa: summary.totals.totalProduitsFcfa || 0,
          fraisLivraisonFcfa: summary.totals.fraisLivraisonFcfa || 0,
          totalFcfa: summary.totals.totalFcfa || 0,
          whatsappMessage: message,
          factureWhatsappTo: chosen,
          submittedAt: new Date(),
        },
      });

      await tx.preorderLog.create({
        data: {
          preorderId,
          action: "SUBMIT",
          note: "Précommande soumise",
          meta: {
            totalFcfa: summary.totals.totalFcfa || 0,
            itemsCount: summary.items.length,
            whatsappTo: chosen,
          },
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
    return res.status(500).json({ error: e.message || "Erreur submit" });
  }
}

module.exports = {
  createDraft,
  setItems,
  getSummary,
  submit,
};