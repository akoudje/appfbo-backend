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
// `required` : l'achat de validation doit être composé (soumission de la fiche).
async function normalizePurchaseCart(raw, { countryId, countryCode, minPurchaseFcfa, required = false }) {
  const missing = () => {
    if (!required) return null;
    throw httpError(
      400,
      `Composez l'achat de parrainage : au moins ${Number(minPurchaseFcfa || 0).toLocaleString("fr-FR")} F au prix Client privilégié.`,
      "SPONSORSHIP_CART_REQUIRED",
    );
  };
  let items = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return missing();
    try {
      items = JSON.parse(raw);
    } catch {
      throw httpError(400, "Panier d'achat illisible.", "SPONSORSHIP_CART_INVALID");
    }
  }
  if (!Array.isArray(items) || items.length === 0) return missing();

  const requested = new Map();
  for (const item of items) {
    const productId = String(item?.productId || "").trim();
    const qty = Number.parseInt(item?.qty, 10);
    if (!productId || !Number.isFinite(qty) || qty <= 0) continue;
    requested.set(productId, (requested.get(productId) || 0) + qty);
  }
  if (!requested.size) return missing();

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
      `Le panier d'achat fait ${totalFcfa.toLocaleString("fr-FR")} F : il doit atteindre au moins ${minPurchaseFcfa.toLocaleString("fr-FR")} F. Complétez-le.`,
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

// Paiement et livraison de l'achat de parrainage : valeurs connues, ouvertes
// dans le pays. `required` : les deux sont obligatoires.
async function normalizePurchaseOptions({ countryId, paymentMode, deliveryMode, required = true }) {
  const { validateCountryOrderOptions } = require("./country-order-options.service");
  const payment = String(paymentMode || "").trim().toUpperCase();
  const delivery = String(deliveryMode || "").trim().toUpperCase();
  if (!payment || !delivery) {
    if (!required && !payment && !delivery) return { payment: null, delivery: null };
    throw httpError(400, "Choisissez le mode de paiement et le mode de livraison de l'achat.", "SPONSORSHIP_PURCHASE_OPTIONS_REQUIRED");
  }
  if (!COUNTER_DELIVERY_MODES.has(delivery)) {
    throw httpError(400, "Achat de parrainage : retrait au siège ou livraison uniquement.", "SPONSORSHIP_DELIVERY_MODE_INVALID");
  }
  const settings = await prisma.countrySettings.findUnique({ where: { countryId } });
  const options = validateCountryOrderOptions({ settings, paymentMode: payment, deliveryMode: delivery, requirePaymentMode: true, requireDeliveryMode: true });
  if (!options.ok) throw httpError(400, options.message || "Mode de paiement ou de livraison non disponible.", "SPONSORSHIP_PURCHASE_OPTIONS_INVALID");
  return { payment, delivery };
}

// Achat au comptoir par le facturier : commande du filleul prête à préfacturer.
// Reprend le brouillon préparé à l'approbation (ou le crée à partir de `items`),
// fixe paiement et livraison, fige les prix comme une soumission et met la
// commande en file de facturation (SUBMITTED). Renvoie la commande.
async function prepareCounterPurchase({ sponsorship, recruitFbo, items, paymentMode, deliveryMode, countryId, countryCode, adminId }) {
  const { payment, delivery } = await normalizePurchaseOptions({ countryId, paymentMode, deliveryMode });

  // 1) Commande brouillon déjà préparée, sinon une nouvelle à partir du panier
  // (celui passé, ou celui du parrainage). Une commande annulée (ex. préfacture
  // non payée dans le délai) est remplacée : c'est une relance.
  let preorder = sponsorship.purchasePreorderId
    ? await prisma.preorder.findFirst({ where: { id: sponsorship.purchasePreorderId, countryId } })
    : null;
  if (preorder?.status === "CANCELLED") preorder = null;
  if (preorder && preorder.status !== "DRAFT") {
    throw httpError(409, `La commande d'achat ${preorder.preorderNumber} est déjà soumise : préfacturez-la depuis la commande.`, "SPONSORSHIP_PURCHASE_ALREADY_SUBMITTED");
  }
  if (!preorder) {
    const cart = await normalizePurchaseCart(Array.isArray(items) && items.length ? items : sponsorship.purchaseItems, {
      countryId,
      countryCode,
      minPurchaseFcfa: Number(sponsorship.minPurchaseFcfa || 0),
    });
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

// Achat de parrainage préfacturé (approbation ou relance) : commande du filleul
// créée à partir du panier, préfacturée avec la référence et le montant AS400,
// SANS la notification habituelle (le parrainage envoie la sienne, avec le lien
// de paiement renvoyé ici).
async function preinvoiceSponsorshipPurchase({ req, sponsorship, recruitFbo, items, paymentMode, deliveryMode, factureReference, invoiceAmountFcfa, note, countryId, countryCode }) {
  const { invoiceAndSendPreorder } = require("./invoiceAndSendPreorder.service");
  const { publishRealtimeEvent } = require("./realtime-events.service");
  const reference = String(factureReference || "").replace(/\s+/g, " ").trim();
  if (!reference) throw httpError(400, "La référence AS400 est obligatoire.", "AS400_REFERENCE_REQUIRED");
  const amount = Number(invoiceAmountFcfa);
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, "Le montant AS400 est obligatoire.", "AS400_AMOUNT_REQUIRED");
  const duplicate = await prisma.preorder.findFirst({
    where: { countryId, factureReference: { equals: reference, mode: "insensitive" } },
    select: { preorderNumber: true },
  });
  if (duplicate) {
    throw httpError(409, `Cette référence AS400 est déjà utilisée sur la commande ${duplicate.preorderNumber}.`, "AS400_REFERENCE_DUPLICATE");
  }

  const order = await prepareCounterPurchase({ sponsorship, recruitFbo, items, paymentMode, deliveryMode, countryId, countryCode, adminId: req.user?.id || null });
  const result = await invoiceAndSendPreorder({
    req,
    preorderId: order.id,
    actorName: req.user?.fullName || req.user?.email || "admin",
    actorAdminId: req.user?.id || null,
    invoiceRefInput: reference,
    whatsappToInput: sponsorship.sponsorPhone || "",
    notificationEmailInput: sponsorship.sponsorEmail || undefined,
    invoiceNote: note || "Achat de parrainage.",
    billingGradeInput: RECRUIT_GRADE,
    invoiceAmountOverrideInput: amount,
    skipNotification: true,
  });
  publishRealtimeEvent({
    countryId,
    eventKey: "cashier_collect_new",
    orderId: result.preorder.id,
    meta: { status: result.preorder.status, paymentStatus: result.preorder.paymentStatus || null },
  });
  return {
    order: result.preorder,
    paymentLink: result.paymentLinkTarget || null,
    amountToPayFcfa: result.paymentPricing?.amountToPayFcfa ?? result.preorder.as400InvoiceTotalFcfa ?? result.preorder.totalFcfa,
    paymentMode: order.preorderPaymentMode,
  };
}

module.exports = {
  normalizePurchaseOptions,
  preinvoiceSponsorshipPurchase,
  RECRUIT_GRADE,
  getRecruitCatalog,
  normalizePurchaseCart,
  createRecruitPurchaseDraft,
  prepareCounterPurchase,
};
