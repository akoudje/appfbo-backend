// src/services/sponsorship-purchase.service.js
// Achat de parrainage : panier optionnel saisi par le parrain à la soumission,
// transformé à l'approbation en commande brouillon du filleul « passée par » le
// parrain. Le parrain choisit ensuite paiement et livraison, puis soumet.

const prisma = require("../prisma");
const { computeCatalogProductsForGrade, computePreorderTotals } = require("./pricing.service");
const { formatDateKey, formatPreorderNumber } = require("../helpers/preorder-number");

const RECRUIT_GRADE = "CLIENT_PRIVILEGIE";

function httpError(statusCode, message, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

async function getQtyLimitPerProduct(countryId) {
  const settings = await prisma.countrySettings.findUnique({
    where: { countryId },
    select: { maxQtyPerProduct: true },
  });
  return Math.max(1, Number(settings?.maxQtyPerProduct || 10));
}

// Catalogue proposé au parrain : prix Client privilégié, produits en stock.
async function getRecruitCatalog({ countryId, countryCode }) {
  const [catalog, globalLimit] = await Promise.all([
    computeCatalogProductsForGrade({ countryId, countryCode, grade: RECRUIT_GRADE }),
    getQtyLimitPerProduct(countryId),
  ]);
  return catalog
    .filter((product) => product.stockQty > 0)
    .map((product) => ({
      id: product.id,
      sku: product.sku,
      nom: product.nom,
      imageUrl: product.imageUrl,
      category: product.category,
      prixFcfa: product.prixFinalFcfa,
      stockQty: product.stockQty,
      maxQty: Math.min(
        product.stockQty,
        globalLimit,
        product.maxQtyPerOrder > 0 ? product.maxQtyPerOrder : globalLimit,
      ),
    }));
}

// Contrôle le panier saisi (champ multipart JSON « purchaseItems »). Renvoie null
// si aucun panier. Bloque si un produit est indisponible, si une quantité dépasse
// le stock ou la limite, ou si le total indicatif est sous le minimum du pays.
async function normalizePurchaseCart(raw, { countryId, countryCode, minPurchaseFcfa }) {
  let items = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      items = JSON.parse(raw);
    } catch {
      throw httpError(400, "Panier d'achat illisible.", "SPONSORSHIP_CART_INVALID");
    }
  }
  if (!Array.isArray(items) || items.length === 0) return null;

  const requested = new Map();
  for (const item of items) {
    const productId = String(item?.productId || "").trim();
    const qty = Number.parseInt(item?.qty, 10);
    if (!productId || !Number.isFinite(qty) || qty <= 0) continue;
    requested.set(productId, (requested.get(productId) || 0) + qty);
  }
  if (!requested.size) return null;

  const catalog = await getRecruitCatalog({ countryId, countryCode });
  const byId = new Map(catalog.map((product) => [product.id, product]));
  const errors = [];
  const lines = [];
  for (const [productId, qty] of requested) {
    const product = byId.get(productId);
    if (!product) {
      errors.push("Un produit du panier n'est plus disponible.");
      continue;
    }
    if (qty > product.maxQty) {
      errors.push(`${product.nom} : ${product.maxQty} au maximum (stock ou limite par commande).`);
      continue;
    }
    lines.push({ productId, sku: product.sku, nom: product.nom, qty, prixFcfa: product.prixFcfa, lineTotalFcfa: Math.round(product.prixFcfa * qty) });
  }
  if (errors.length) throw httpError(400, errors.join(" "), "SPONSORSHIP_CART_STOCK");

  const totalFcfa = lines.reduce((sum, line) => sum + line.lineTotalFcfa, 0);
  if (totalFcfa < minPurchaseFcfa) {
    throw httpError(
      400,
      `Le panier d'achat fait ${totalFcfa.toLocaleString("fr-FR")} F : il doit atteindre au moins ${minPurchaseFcfa.toLocaleString("fr-FR")} F. Complétez-le ou retirez-le.`,
      "SPONSORSHIP_CART_BELOW_MINIMUM",
    );
  }
  return { items: lines, totalFcfa };
}

// Crée la commande brouillon du filleul à partir du panier, avec les quantités
// recalées sur le stock du moment. Renvoie { preorder, adjustments } ou null.
async function createRecruitPurchaseDraft({ sponsorship, recruitFbo, countryId, countryCode }) {
  const planned = Array.isArray(sponsorship.purchaseItems) ? sponsorship.purchaseItems : [];
  if (!planned.length) return null;

  const catalog = await getRecruitCatalog({ countryId, countryCode });
  const byId = new Map(catalog.map((product) => [product.id, product]));
  const adjustments = [];
  const items = [];
  for (const line of planned) {
    const product = byId.get(line.productId);
    const label = line.nom || product?.nom || "Un produit";
    if (!product) {
      adjustments.push(`${label} : retiré, plus disponible.`);
      continue;
    }
    const qty = Math.min(Number(line.qty) || 0, product.maxQty);
    if (qty <= 0) continue;
    if (qty < line.qty) adjustments.push(`${label} : quantité ajustée de ${line.qty} à ${qty} selon le stock.`);
    items.push({ productId: line.productId, qty });
  }
  if (!items.length) return { preorder: null, adjustments };

  const preorderDateKey = formatDateKey(new Date());
  const now = new Date();
  const preorder = await prisma.$transaction(async (tx) => {
    const last = await tx.preorder.findFirst({
      where: { countryId, preorderDateKey },
      orderBy: { preorderSeq: "desc" },
      select: { preorderSeq: true },
    });
    const seq = (last?.preorderSeq || 0) + 1;
    const created = await tx.preorder.create({
      data: {
        countryId,
        fboId: recruitFbo.id,
        fboNumero: recruitFbo.numeroFbo,
        fboNomComplet: recruitFbo.nomComplet,
        fboEmail: recruitFbo.email || null,
        fboGrade: RECRUIT_GRADE,
        pointDeVente: recruitFbo.pointDeVente,
        placedByFboNumero: sponsorship.sponsorNumero,
        placedByFboName: sponsorship.sponsorNom,
        placedByFboPhone: sponsorship.sponsorPhone || null,
        status: "DRAFT",
        paymentStatus: "UNPAID",
        billingWorkStatus: "NONE",
        preorderNumber: formatPreorderNumber({ countryCode, dateKey: preorderDateKey, seq }),
        preorderSeq: seq,
        preorderDateKey,
        createdAt: now,
        updatedAt: now,
      },
    });
    await tx.preorderItem.createMany({
      data: items.map((item) => ({
        preorderId: created.id,
        productId: item.productId,
        qty: item.qty,
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
    await tx.preorderLog.create({
      data: {
        preorderId: created.id,
        action: "CREATE_DRAFT",
        note: `Brouillon créé à l'approbation du parrainage (achat de validation, passé par ${sponsorship.sponsorNom}).`,
        meta: { source: "SPONSORSHIP_PURCHASE", sponsorshipId: sponsorship.id, adjustments },
      },
    });
    return created;
  });

  // Prix et totaux calculés par le moteur habituel (comme « recommander »).
  const summary = await computePreorderTotals(preorder.id, countryId);
  await prisma.preorder.update({
    where: { id: preorder.id },
    data: {
      totalCc: String(Number(summary.totals.totalCc || 0).toFixed(3)),
      totalPoidsKg: String(Number(summary.totals.totalPoidsKg || 0).toFixed(3)),
      totalProduitsFcfa: summary.totals.totalProduitsFcfa || 0,
      fraisLivraisonFcfa: summary.totals.fraisLivraisonFcfa || 0,
      emballageFcfa: summary.totals.emballageFcfa || 0,
      totalFcfa: summary.totals.totalFcfa || 0,
    },
  });
  return { preorder, adjustments };
}

// Modes de livraison autorisés pour l'achat au comptoir (pas d'expédition, qui
// demande des informations de destinataire).
const COUNTER_DELIVERY_MODES = new Set(["RETRAIT_SITE_FLP", "LIVRAISON"]);

// Achat au comptoir par le facturier : commande du filleul prête à préfacturer.
// Reprend le brouillon préparé à l'approbation (ou le crée à partir de `items`),
// fixe paiement et livraison, fige les prix comme une soumission et met la
// commande en file de facturation (SUBMITTED). Renvoie la commande.
async function prepareCounterPurchase({ sponsorship, recruitFbo, items, paymentMode, deliveryMode, countryId, countryCode, adminId }) {
  const { validateCountryOrderOptions } = require("./country-order-options.service");
  const settings = await prisma.countrySettings.findUnique({ where: { countryId } });
  const payment = String(paymentMode || "").trim().toUpperCase();
  const delivery = String(deliveryMode || "").trim().toUpperCase();
  if (!payment || !delivery) throw httpError(400, "Choisissez le mode de paiement et le mode de livraison.");
  if (!COUNTER_DELIVERY_MODES.has(delivery)) {
    throw httpError(400, "Achat au comptoir : retrait au siège ou livraison uniquement (l'expédition se fait depuis la commande).");
  }
  const options = validateCountryOrderOptions({ settings, paymentMode: payment, deliveryMode: delivery, requirePaymentMode: true, requireDeliveryMode: true });
  if (!options.ok) throw httpError(400, options.message || "Mode de paiement ou de livraison non disponible.");

  // 1) Commande brouillon : celle préparée à l'approbation, sinon une nouvelle.
  let preorder = sponsorship.purchasePreorderId
    ? await prisma.preorder.findFirst({ where: { id: sponsorship.purchasePreorderId, countryId } })
    : null;
  if (preorder && preorder.status !== "DRAFT") {
    throw httpError(409, `La commande d'achat ${preorder.preorderNumber} est déjà soumise : préfacturez-la depuis la commande.`, "SPONSORSHIP_PURCHASE_ALREADY_SUBMITTED");
  }
  if (!preorder) {
    const cart = await normalizePurchaseCart(items, { countryId, countryCode, minPurchaseFcfa: Number(sponsorship.minPurchaseFcfa || 0) });
    if (!cart) throw httpError(400, "Aucun panier préparé : ajoutez les produits de l'achat.");
    const created = await createRecruitPurchaseDraft({
      sponsorship: { ...sponsorship, purchaseItems: cart.items },
      recruitFbo,
      countryId,
      countryCode,
    });
    if (!created?.preorder) throw httpError(409, "Aucun produit du panier n'est disponible en stock.");
    preorder = created.preorder;
    await prisma.sponsorship.update({ where: { id: sponsorship.id }, data: { purchasePreorderId: preorder.id } });
  }

  // 2) Paiement / livraison, puis prix figés comme lors d'une soumission.
  await prisma.preorder.update({ where: { id: preorder.id }, data: { preorderPaymentMode: payment, deliveryMode: delivery } });
  const summary = await computePreorderTotals(preorder.id, countryId);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const it of summary.items) {
      await tx.preorderItem.update({
        where: { preorderId_productId: { preorderId: preorder.id, productId: it.productId } },
        data: {
          productSkuSnapshot: it.sku || null,
          productNameSnapshot: it.nom || null,
          prixCatalogueFcfa: it.prixCatalogueFcfa != null ? it.prixCatalogueFcfa : it.prixUnitaireFcfa,
          discountPercent: String(Number(it.discountPercent != null ? it.discountPercent : 0).toFixed(2)),
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
      where: { id: preorder.id },
      data: {
        status: "SUBMITTED",
        paymentStatus: "UNPAID",
        billingWorkStatus: "QUEUED",
        billingQueueEnteredAt: now,
        submittedAt: now,
        factureWhatsappTo: sponsorship.sponsorPhone || null,
        totalCc: String(Number(summary.totals.totalCc || 0).toFixed(3)),
        totalPoidsKg: String(Number(summary.totals.totalPoidsKg || 0).toFixed(3)),
        totalProduitsFcfa: summary.totals.totalProduitsFcfa || 0,
        fraisLivraisonFcfa: summary.totals.fraisLivraisonFcfa || 0,
        emballageFcfa: summary.totals.emballageFcfa || 0,
        totalFcfa: summary.totals.totalFcfa || 0,
      },
    });
    await tx.preorderLog.create({
      data: {
        preorderId: preorder.id,
        action: "SUBMIT",
        note: "Achat de parrainage soumis au comptoir par le facturier.",
        meta: { source: "SPONSORSHIP_COUNTER_PURCHASE", sponsorshipId: sponsorship.id, preorderPaymentMode: payment, deliveryMode: delivery },
        actorAdminId: adminId || null,
      },
    });
  });
  return prisma.preorder.findUnique({ where: { id: preorder.id } });
}

module.exports = {
  RECRUIT_GRADE,
  getRecruitCatalog,
  normalizePurchaseCart,
  createRecruitPurchaseDraft,
  prepareCounterPurchase,
};
