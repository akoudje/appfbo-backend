// src/controllers/preorders.controller.js

const prisma = require("../prisma");
const {
  computePreorderTotals,
  computeCatalogProductsForPreorder,
} = require("../services/pricing.service");
const {
  buildPreorderSmsMessage,
  normalizePhoneForCountry,
  fetchSmsStatus,
} = require("../services/sms.service");
const {
  sendPreorderNotification,
} = require("../services/preorder-notifications.service");
const billingQueueService = require("../services/billingQueue.service");
const { publishRealtimeEvent } = require("../services/realtime-events.service");
const { scopeWhere, scopeCreate } = require("../helpers/countryScope");
const { formatDateKey, formatPreorderNumber } = require("../helpers/preorder-number");
const {
  resolveDeliveryModeForPayment,
  validateCountryOrderOptions,
} = require("../services/country-order-options.service");
const {
  fetchFboDirectoryProfile,
  isFboDirectoryTemporarilyUnavailable,
} = require("../services/fboDirectory.service");

const BILLING_WHATSAPPS = [process.env.BILLING_WA_1]
  .map((phone) => String(phone || "").trim())
  .filter(Boolean);
const PREORDER_SUBMISSION_DISABLED_MESSAGE =
  process.env.PREORDER_SUBMISSION_DISABLED_MESSAGE ||
  "Les soumissions de précommandes sont temporairement suspendues.";
const FBO_CHECK_RATE_LIMIT_WINDOW_MS = Number(process.env.FBO_CHECK_RATE_LIMIT_WINDOW_MS || 60000);
const FBO_CHECK_RATE_LIMIT_MAX = Number(process.env.FBO_CHECK_RATE_LIMIT_MAX || 30);
const fboCheckRateLimitBuckets = new Map();
const DATA_PROTECTION_CONSENT_VERSION = "preorder-step1-v1";
const DEFAULT_POINT_DE_VENTE_BY_COUNTRY = {
  CIV: "ABIDJAN",
  BFA: "OUAGADOUGOU",
  TGO: "LOME",
  BEN: "COTONOU",
  NER: "NIAMEY",
};
const VALID_GRADES = [
  "CLIENT_PRIVILEGIE",
  "ANIMATEUR_ADJOINT",
  "ANIMATEUR",
  "MANAGER_ADJOINT",
  "MANAGER",
];

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizeNumeroFbo(v) {
  return String(v || "").trim();
}

function normalizeEmail(v = "") {
  const email = String(v || "").trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "__INVALID_EMAIL__";
  return email;
}

function normalizeClientIdempotencyKey(value = "") {
  const key = String(value || "").trim();
  if (!key) return null;
  return key.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 128) || null;
}

function getClientIdempotencyKey(req, bodyField) {
  return normalizeClientIdempotencyKey(
    req.body?.[bodyField] ||
      req.headers["x-idempotency-key"] ||
      req.headers["idempotency-key"],
  );
}

function serializeExistingPreorder(preorder) {
  return {
    preorderId: preorder.id,
    preorderNumber: preorder.preorderNumber,
    status: preorder.status,
    billingWorkStatus: preorder.billingWorkStatus || "NONE",
    assignedInvoicerId: preorder.assignedInvoicerId || null,
    totals: {
      totalCc: Number(preorder.totalCc || 0),
      totalPoidsKg: Number(preorder.totalPoidsKg || 0),
      totalProduitsFcfa: Number(preorder.totalProduitsFcfa || 0),
      fraisLivraisonFcfa: Number(preorder.fraisLivraisonFcfa || 0),
      totalFcfa: Number(preorder.totalFcfa || 0),
    },
    smsTo: preorder.factureWhatsappTo || null,
    smsStatus: mapSmsStatus(preorder.lastWhatsappStatus),
    smsLastError: null,
    smsLastSentAt: preorder.lastWhatsappStatusAt
      ? preorder.lastWhatsappStatusAt.toISOString()
      : null,
    reused: true,
  };
}

function normalizeGrade(raw) {
  const normalized = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
  const normalizedText = String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

  const aliases = {
    CLIENTPRIVILEGIE: "CLIENT_PRIVILEGIE",
    PREFERRED_CUSTOMER: "CLIENT_PRIVILEGIE",
    PREFERREDCUSTOMER: "CLIENT_PRIVILEGIE",
    ANIMATEURADJOINT: "ANIMATEUR_ADJOINT",
    ASSISTANT_SUPERVISOR: "ANIMATEUR_ADJOINT",
    ASSISTANTSUPERVISOR: "ANIMATEUR_ADJOINT",
    SUPERVISOR: "ANIMATEUR",
    MANAGERADJOINT: "MANAGER_ADJOINT",
    ASSISTANT_MANAGER: "MANAGER_ADJOINT",
    ASSISTANTMANAGER: "MANAGER_ADJOINT",
    UNRECOGNIZED_MANAGER: "MANAGER",
    UNRECOGNIZEDMANAGER: "MANAGER",
    RECOGNIZED_MANAGER: "MANAGER",
    RECOGNIZEDMANAGER: "MANAGER",
    SENIOR_MANAGER: "MANAGER",
    SENIORMANAGER: "MANAGER",
    SOARING_MANAGER: "MANAGER",
    SOARINGMANAGER: "MANAGER",
    DIAMOND_MANAGER: "MANAGER",
    DIAMONDMANAGER: "MANAGER",
    SAPPHIRE_MANAGER: "MANAGER",
    SAPPHIREMANAGER: "MANAGER",
  };

  if (VALID_GRADES.includes(normalized)) return normalized;
  if (
    normalizedText.includes("MANAGER") &&
    (normalizedText.includes("UNRECOGNIZED") ||
      normalizedText.includes("UNRECOGNISED") ||
      (normalizedText.includes("NON") && normalizedText.includes("RECONNU")))
  ) {
    return "MANAGER";
  }
  return aliases[normalized] || "";
}

function mapSmsStatus(rawStatus) {
  const s = String(rawStatus || "").trim().toUpperCase();
  if (["SENT", "DELIVERED", "READ"].includes(s)) return "sent";
  if (["FAILED", "CANCELLED"].includes(s)) return "failed";
  return "pending";
}

function digitsOnly(v = "") {
  return String(v || "").replace(/\D/g, "");
}

function resolveDefaultPointDeVente(countryCode = "", settings = null) {
  const configured = String(settings?.defaultPointDeVente || "").trim();
  if (configured) return configured.toUpperCase();

  const normalizedCode = String(countryCode || "").trim().toUpperCase();
  return DEFAULT_POINT_DE_VENTE_BY_COUNTRY[normalizedCode] || normalizedCode || "ABIDJAN";
}

function isExplicitConsentAccepted(value) {
  if (value === true) return true;
  if (typeof value === "string") {
    return ["true", "1", "yes", "oui"].includes(value.trim().toLowerCase());
  }
  return false;
}

function getRequestIp(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || "unknown";
}

function enforceFboCheckRateLimit(req) {
  const now = Date.now();
  const ip = getRequestIp(req);
  const bucket = fboCheckRateLimitBuckets.get(ip) || { count: 0, resetAt: now + FBO_CHECK_RATE_LIMIT_WINDOW_MS };

  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + FBO_CHECK_RATE_LIMIT_WINDOW_MS;
  }

  bucket.count += 1;
  fboCheckRateLimitBuckets.set(ip, bucket);

  if (fboCheckRateLimitBuckets.size > 5000) {
    for (const [key, value] of fboCheckRateLimitBuckets.entries()) {
      if (value.resetAt <= now) fboCheckRateLimitBuckets.delete(key);
    }
  }

  return bucket.count <= FBO_CHECK_RATE_LIMIT_MAX;
}

function sanitizeFboDirectoryPayload(payload) {
  if (!payload || payload.exists === false) return { exists: false };
  return {
    exists: true,
    grade: typeof payload.grade === "string" ? payload.grade : null,
  };
}

function normalizeFboDirectoryProfile(payload) {
  if (!payload || payload.exists === false) {
    return { exists: false };
  }

  return {
    exists: true,
    fullName: String(
      payload.full_name ||
        payload.fullName ||
        payload.nomComplet ||
        "",
    ).trim(),
    grade: normalizeGrade(payload.grade),
  };
}

function isBillingNumber(phone = "") {
  const target = digitsOnly(phone);
  if (!target) return false;

  return BILLING_WHATSAPPS.some((n) => digitsOnly(n) === target);
}

function extractNotificationFromPreorder(preorder) {
  return {
    smsStatus: mapSmsStatus(preorder?.lastWhatsappStatus),
    smsLastError: null,
    smsLastSentAt: preorder?.lastWhatsappStatusAt || null,
  };
}

function mapDeliveryToPersistedStatus(deliveryStatus) {
  if (deliveryStatus === "delivered") return "DELIVERED";
  if (deliveryStatus === "failed") return "FAILED";
  if (deliveryStatus === "pending") return "SENT";
  return null;
}

function resolveMaxQtyForProduct(product, globalMaxQtyPerProduct) {
  const globalLimit = Math.max(1, Number(globalMaxQtyPerProduct || 10));
  const productLimit = Number(product?.maxQtyPerOrder);

  if (Number.isFinite(productLimit) && productLimit > 0) {
    return Math.min(globalLimit, Math.floor(productLimit));
  }

  return globalLimit;
}

function isEnvSubmissionDisabled() {
  return String(process.env.PREORDER_SUBMISSION_DISABLED || "false").toLowerCase() === "true";
}

function resolveSubmissionDisabledMessage(settings) {
  return (
    settings?.preorderSubmissionDisabledMessage ||
    PREORDER_SUBMISSION_DISABLED_MESSAGE
  );
}

function findItemsExceedingProductLimits(items, productsById, globalMaxQtyPerProduct) {
  const violations = [];

  for (const item of Array.isArray(items) ? items : []) {
    const product = productsById.get(item.productId);
    if (!product) continue;

    const limit = resolveMaxQtyForProduct(product, globalMaxQtyPerProduct);
    const qty = Math.max(0, parseInt(item.qty || 0, 10) || 0);

    if (qty > limit) {
      violations.push({
        productId: item.productId,
        sku: product.sku || null,
        nom: product.nom || "Produit",
        qty,
        limit,
      });
    }
  }

  return violations;
}

async function createDraft(req, res) {
  try {
    const {
      numeroFbo,
      nomComplet,
      email,
      grade,
      paymentMode = null,
      deliveryMode = null,
      placedByFboNumero = "",
      placedByFboName = "",
      placedByFboPhone = "",
      placedByFboEmail = "",
      placedByHomeCountryCode = "",
      personalDataConsentAccepted = false,
      personalDataConsentVersion = DATA_PROTECTION_CONSENT_VERSION,
    } = req.body || {};

    if (
      !isNonEmptyString(numeroFbo)
    ) {
      return res.status(400).json({
        error: "numeroFbo est requis",
      });
    }

    const normalizedNumeroFbo = normalizeNumeroFbo(numeroFbo);
    let directoryProfile = { exists: false };
    let directoryLookupWarning = null;
    try {
      directoryProfile = normalizeFboDirectoryProfile(
        await fetchFboDirectoryProfile(normalizedNumeroFbo),
      );
    } catch (error) {
      if (!isFboDirectoryTemporarilyUnavailable(error)) {
        throw error;
      }

      directoryLookupWarning = error?.message || "Service FBO indisponible";
      console.warn("createDraft FBO directory fallback:", {
        numeroFbo: normalizedNumeroFbo,
        message: directoryLookupWarning,
        statusCode: error?.statusCode || null,
      });
    }
    const clientName = String(nomComplet || "").trim();
    const clientGrade = normalizeGrade(grade);

    if (directoryProfile.exists && (!directoryProfile.fullName || !directoryProfile.grade)) {
      return res.status(502).json({
        error: "Profil FBO incomplet dans le service FBO",
      });
    }

    const normalizedNomComplet = (
      directoryProfile.exists ? directoryProfile.fullName : clientName
    ).toUpperCase();
    const normalizedGrade = directoryProfile.exists
      ? directoryProfile.grade
      : clientGrade;

    if (!normalizedNomComplet || !normalizedGrade) {
      return res.status(400).json({
        error: "Nom complet et grade sont requis pour continuer",
      });
    }
    // Le consentement n'est plus exigé à la création du brouillon : consulter le
    // catalogue avec son numéro FBO ne nécessite pas d'accord préalable. Il est
    // en revanche obligatoire à la soumission finale (voir submit()).
    const consentAccepted = isExplicitConsentAccepted(personalDataConsentAccepted);
    const consentVersion =
      String(personalDataConsentVersion || DATA_PROTECTION_CONSENT_VERSION).trim() ||
      DATA_PROTECTION_CONSENT_VERSION;
    const hasEmailField = Object.prototype.hasOwnProperty.call(req.body || {}, "email");
    const normalizedEmail = normalizeEmail(email);

    if (normalizedEmail === "__INVALID_EMAIL__") {
      return res.status(400).json({
        error: "Format email invalide",
      });
    }

    const normalizedPaymentMode = paymentMode
      ? String(paymentMode).trim().toUpperCase()
      : null;
    const normalizedPlacedByFboNumero = placedByFboNumero
      ? normalizeNumeroFbo(placedByFboNumero)
      : null;
    const normalizedPlacedByName = String(placedByFboName || "").trim().toUpperCase() || null;
    const normalizedPlacedByPhone = String(placedByFboPhone || "").trim() || null;
    const normalizedPlacedByEmail = normalizeEmail(placedByFboEmail);
    const normalizedPlacedByHomeCountryCode =
      String(placedByHomeCountryCode || "").trim().toUpperCase() || null;

    if (normalizedPlacedByEmail === "__INVALID_EMAIL__") {
      return res.status(400).json({
        error: "Format email du FBO initiateur invalide",
      });
    }

    const requestedDeliveryMode = deliveryMode
      ? String(deliveryMode).trim().toUpperCase()
      : null;

    const countryId = req.country?.id || req.scope?.countryId || req.countryId;
    const countryCode =
      req.country?.code ||
      req.scope?.countryCode ||
      req.headers["x-country"] ||
      "CIV";

    if (!countryId) {
      return res.status(400).json({
        error: "countryId introuvable dans le scope de la requête",
      });
    }

    const clientDraftKey = getClientIdempotencyKey(req, "clientDraftKey");
    if (clientDraftKey) {
      const existingDraft = await prisma.preorder.findFirst({
        where: {
          countryId,
          clientDraftKey,
        },
        select: {
          id: true,
          preorderNumber: true,
          status: true,
          fboNomComplet: true,
          fboGrade: true,
        },
      });

      if (existingDraft) {
        return res.json({
          preorderId: existingDraft.id,
          preorderNumber: existingDraft.preorderNumber,
          status: existingDraft.status,
          fboNomComplet: existingDraft.fboNomComplet,
          fboGrade: existingDraft.fboGrade,
          reused: true,
        });
      }
    }

    const countrySettings = await prisma.countrySettings.findUnique({
      where: { countryId },
      select: {
        enableWave: true,
        enableOrangeMoney: true,
        enableCash: true,
        enableBankTransfer: true,
        enableEcobankPay: true,
        enablePiSpi: true,
        enableDelivery: true,
        enablePickup: true,
        defaultPointDeVente: true,
      },
    });
    const normalizedPointDeVente = resolveDefaultPointDeVente(countryCode, countrySettings);

    const normalizedDeliveryMode = resolveDeliveryModeForPayment(
      normalizedPaymentMode,
      requestedDeliveryMode,
    );

    const optionValidation = validateCountryOrderOptions({
      settings: countrySettings,
      paymentMode: normalizedPaymentMode,
      deliveryMode: normalizedDeliveryMode,
    });

    if (!optionValidation.ok) {
      return res.status(400).json({
        error: optionValidation.message,
        code: optionValidation.code,
      });
    }

    const preorderDateKey = formatDateKey(new Date());

    const fbo = await prisma.fbo.upsert({
      where: { numeroFbo: normalizedNumeroFbo },
      update: {
        nomComplet: normalizedNomComplet,
        ...(hasEmailField ? { email: normalizedEmail } : {}),
        grade: normalizedGrade,
        pointDeVente: normalizedPointDeVente,
      },
      create: {
        numeroFbo: normalizedNumeroFbo,
        nomComplet: normalizedNomComplet,
        email: normalizedEmail,
        grade: normalizedGrade,
        pointDeVente: normalizedPointDeVente,
      },
    });

    const preorder = await prisma.$transaction(async (tx) => {
      const lastPreorderOfDay = await tx.preorder.findFirst({
        where: {
          countryId,
          preorderDateKey,
        },
        orderBy: {
          preorderSeq: "desc",
        },
        select: {
          preorderSeq: true,
        },
      });

      const nextSeq = (lastPreorderOfDay?.preorderSeq || 0) + 1;

      const preorderNumber = formatPreorderNumber({
        countryCode,
        dateKey: preorderDateKey,
        seq: nextSeq,
      });

      const created = await tx.preorder.create({
        data: scopeCreate(req, {
          fboId: fbo.id,
          fboNumero: fbo.numeroFbo,
          fboNomComplet: fbo.nomComplet,
          fboEmail: fbo.email || null,
          fboGrade: fbo.grade,
          pointDeVente: fbo.pointDeVente,
          placedByFboNumero:
            normalizedPlacedByFboNumero &&
            normalizedPlacedByFboNumero !== fbo.numeroFbo
              ? normalizedPlacedByFboNumero
              : null,
          placedByFboName:
            normalizedPlacedByFboNumero &&
            normalizedPlacedByFboNumero !== fbo.numeroFbo
              ? normalizedPlacedByName
              : null,
          placedByFboPhone:
            normalizedPlacedByFboNumero &&
            normalizedPlacedByFboNumero !== fbo.numeroFbo
              ? normalizedPlacedByPhone
              : null,
          placedByFboEmail:
            normalizedPlacedByFboNumero &&
            normalizedPlacedByFboNumero !== fbo.numeroFbo
              ? normalizedPlacedByEmail || null
              : null,
          placedByHomeCountryCode:
            normalizedPlacedByFboNumero &&
            normalizedPlacedByFboNumero !== fbo.numeroFbo
              ? normalizedPlacedByHomeCountryCode
              : null,

          preorderPaymentMode: normalizedPaymentMode,
          deliveryMode: normalizedDeliveryMode,
          personalDataConsentAccepted: consentAccepted,
          personalDataConsentAcceptedAt: consentAccepted ? new Date() : null,
          personalDataConsentVersion: consentVersion,

          status: "DRAFT",
          billingWorkStatus: "NONE",
          paymentStatus: "UNPAID",

          preorderNumber,
          preorderSeq: nextSeq,
          preorderDateKey,
          clientDraftKey,
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
            email: fbo.email || null,
            preorderPaymentMode: normalizedPaymentMode,
            deliveryMode: normalizedDeliveryMode,
            preorderNumber,
            preorderSeq: nextSeq,
            preorderDateKey,
            countryId,
            countryCode,
            personalDataConsentAccepted: consentAccepted,
            personalDataConsentVersion: consentVersion,
            placedByFboNumero:
              normalizedPlacedByFboNumero &&
              normalizedPlacedByFboNumero !== fbo.numeroFbo
                ? normalizedPlacedByFboNumero
                : null,
            placedByHomeCountryCode: normalizedPlacedByHomeCountryCode,
          },
        },
      });

      return created;
    });

    return res.json({
      preorderId: preorder.id,
      preorderNumber: preorder.preorderNumber,
      status: preorder.status,
      directoryLookupWarning,
      fboNomComplet: preorder.fboNomComplet,
      fboGrade: preorder.fboGrade,
    });
  } catch (e) {
    if (e?.code === "P2002") {
      const countryId = req.country?.id || req.scope?.countryId || req.countryId;
      const clientDraftKey = getClientIdempotencyKey(req, "clientDraftKey");
      if (countryId && clientDraftKey) {
        const existingDraft = await prisma.preorder.findFirst({
          where: { countryId, clientDraftKey },
          select: { id: true, preorderNumber: true, status: true, fboNomComplet: true, fboGrade: true },
        });
        if (existingDraft) {
          return res.json({
            preorderId: existingDraft.id,
            preorderNumber: existingDraft.preorderNumber,
            status: existingDraft.status,
            fboNomComplet: existingDraft.fboNomComplet,
            fboGrade: existingDraft.fboGrade,
            reused: true,
          });
        }
      }
      return res.status(409).json({
        error: "Conflit de numérotation détecté. Réessayez immédiatement.",
      });
    }

    if (e?.statusCode) {
      return res.status(e.statusCode).json({
        error: e.message || "Service FBO indisponible",
      });
    }

    return res.status(500).json({
      error: e.message || "Erreur createDraft",
    });
  }
}

async function checkFboDirectory(req, res) {
  try {
    const numero = String(req.params.numero || "").trim();
    if (digitsOnly(numero).length !== 12) {
      return res.status(400).json({ error: "Numéro FBO invalide" });
    }

    if (!enforceFboCheckRateLimit(req)) {
      return res.status(429).json({ error: "Trop de vérifications FBO. Réessayez plus tard." });
    }

    const payload = await fetchFboDirectoryProfile(numero);
    res.setHeader("Cache-Control", "no-store");
    return res.json(sanitizeFboDirectoryPayload(payload));
  } catch (e) {
    console.error("checkFboDirectory error:", {
      message: e?.message || String(e),
      statusCode: e?.statusCode || null,
    });
    return res.status(e?.statusCode || 502).json({
      error: e?.message || "Service FBO indisponible",
    });
  }
}

async function getCatalog(req, res) {
  const preorderId = req.params.id;
  const countryId = req.country.id;

  try {
    const items = await computeCatalogProductsForPreorder(preorderId, countryId);

    return res.json({
      preorderId,
      items,
    });
  } catch (e) {
    if (String(e.message) === "PREORDER_NOT_FOUND") {
      return res.status(404).json({ error: "Preorder not found" });
    }

    return res.status(500).json({ error: e.message || "Erreur getCatalog" });
  }
}

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
      include: {
        country: {
          include: {
            settings: {
              select: { maxQtyPerProduct: true },
            },
          },
        },
      },
    });

    if (!preorder) {
      return res.status(404).json({ error: "Preorder not found" });
    }

    if (preorder.status !== "DRAFT") {
      return res.status(400).json({ error: "Preorder not editable" });
    }

    const globalMaxQtyPerProduct = Math.max(
      1,
      Number(preorder?.country?.settings?.maxQtyPerProduct || 10),
    );

    const requestedItems = items
      .map((it) => ({
        productId: String(it.productId || "").trim(),
        qty: Math.max(0, parseInt(it.qty || 0, 10) || 0),
      }))
      .filter((it) => it.productId && it.qty > 0);

    const productIds = [...new Set(requestedItems.map((it) => it.productId))];
    const productsById = new Map();

    if (productIds.length > 0) {
      const products = await prisma.product.findMany({
        where: {
          id: { in: productIds },
          countryProducts: {
            some: {
              countryId,
              actif: true,
            },
          },
        },
        select: {
          id: true,
          sku: true,
          nom: true,
          countryProducts: {
            where: { countryId },
            select: { maxQtyPerOrder: true },
          },
        },
      });

      if (products.length !== productIds.length) {
        return res.status(400).json({
          error: "Certains produits sont invalides pour le pays courant",
        });
      }

      for (const product of products) {
        const countryProduct = product.countryProducts?.[0] || {};
        productsById.set(product.id, {
          ...product,
          maxQtyPerOrder: countryProduct.maxQtyPerOrder,
        });
      }
    }

    const normalized = requestedItems.map((it) => {
      const product = productsById.get(it.productId);
      const limit = resolveMaxQtyForProduct(product, globalMaxQtyPerProduct);

      return {
        productId: it.productId,
        qty: Math.min(it.qty, limit),
      };
    });

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
            Number(summary.totals.totalPoidsKg || 0).toFixed(3),
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
      preorderNumber:
        summary?.preorder?.preorderNumber || preorder.preorderNumber,
      items: summary.items,
      totals: summary.totals,
    });
  } catch (e) {
    if (String(e.message) === "PRODUCT_GRADE_PRICE_MISSING") {
      return res.status(400).json({
        error:
          "Un ou plusieurs produits n'ont pas encore de prix par grade pour ce catalogue pays.",
      });
    }
    return res.status(500).json({ error: e.message || "Erreur setItems" });
  }
}

async function getSummary(req, res) {
  const preorderId = req.params.id;
  const countryId = req.country.id;

  try {
    const summary = await computePreorderTotals(preorderId, countryId);
    const preorder = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id: preorderId }),
      select: {
        lastWhatsappStatus: true,
        lastWhatsappStatusAt: true,
      },
    });

    return res.json({
      preorderId,
      preorderNumber: summary?.preorder?.preorderNumber || null,
      discountPercent: summary.discountPercent,
      items: summary.items,
      totals: summary.totals,
      ...extractNotificationFromPreorder(preorder),
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
        "PRODUCT_GRADE_PRICE_MISSING",
      ].includes(String(e.message))
    ) {
      return res.status(400).json({
        error:
          String(e.message) === "PRODUCT_GRADE_PRICE_MISSING"
            ? "Un ou plusieurs produits n'ont pas encore de prix par grade pour ce catalogue pays."
            : "Un ou plusieurs produits du panier sont invalides.",
      });
    }

    return res.status(500).json({ error: e.message || "Erreur getSummary" });
  }
}

async function submit(req, res) {
  const preorderId = req.params.id;
  const {
    phoneRaw,
    phoneNormalized,
    email,
    paymentMode,
    deliveryMode,
    personalDataConsentAccepted,
    personalDataConsentVersion,
  } = req.body || {};
  const countryId = req.country.id;
  const clientSubmissionKey = getClientIdempotencyKey(req, "clientSubmissionKey");

  if (isEnvSubmissionDisabled()) {
    return res.status(503).json({
      error: PREORDER_SUBMISSION_DISABLED_MESSAGE,
      code: "PREORDER_SUBMISSION_DISABLED",
    });
  }

  try {
    const preorder = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id: preorderId }),
      include: {
        items: {
          include: {
            product: {
              include: {
                countryProducts: {
                  where: { countryId },
                  select: { maxQtyPerOrder: true },
                },
              },
            },
          },
        },
        country: { include: { settings: true } },
      },
    });

    if (!preorder) {
      return res.status(404).json({ error: "Preorder not found" });
    }

    if (preorder.country?.settings?.preorderSubmissionEnabled === false) {
      return res.status(503).json({
        error: resolveSubmissionDisabledMessage(preorder.country.settings),
        code: "PREORDER_SUBMISSION_DISABLED",
      });
    }

    if (preorder.status !== "DRAFT") {
      if (
        clientSubmissionKey &&
        preorder.clientSubmissionKey &&
        preorder.clientSubmissionKey === clientSubmissionKey
      ) {
        return res.json(serializeExistingPreorder(preorder));
      }
      return res.status(400).json({ error: "Preorder not editable" });
    }

    if (
      clientSubmissionKey &&
      preorder.clientSubmissionKey &&
      preorder.clientSubmissionKey !== clientSubmissionKey
    ) {
      return res.status(409).json({
        error: "Une autre tentative de soumission est déjà associée à cette précommande.",
        code: "PREORDER_SUBMISSION_KEY_CONFLICT",
      });
    }

    if (!preorder.items || preorder.items.length === 0) {
      return res
        .status(400)
        .json({ error: "Panier vide. Ajoute au moins 1 article." });
    }

    const violations = findItemsExceedingProductLimits(
      preorder.items,
      new Map(
        (preorder.items || []).map((item) => {
          const countryProduct = item.product?.countryProducts?.[0] || {};
          return [
            item.productId,
            {
              ...item.product,
              maxQtyPerOrder: countryProduct.maxQtyPerOrder,
            },
          ];
        }),
      ),
      preorder?.country?.settings?.maxQtyPerProduct || 10,
    );

    if (violations.length > 0) {
      const first = violations[0];
      return res.status(400).json({
        error: `${first.nom} est limité à ${first.limit} unité${first.limit > 1 ? "s" : ""} par commande.`,
        code: "PRODUCT_MAX_QTY_EXCEEDED",
        violations,
      });
    }

    if (!isNonEmptyString(preorder.fboNumero) || !preorder.fboGrade) {
      return res
        .status(400)
        .json({ error: "Les informations FBO sont incomplètes." });
    }

    // Le consentement n'est plus exigé à la création du brouillon (voir
    // createDraft()) : il est obligatoire ici, à la soumission finale.
    const requestedConsentAccepted = isExplicitConsentAccepted(personalDataConsentAccepted);
    const effectiveConsentAccepted = Boolean(preorder.personalDataConsentAccepted) || requestedConsentAccepted;

    if (!effectiveConsentAccepted) {
      return res.status(400).json({
        error: "Consentement au traitement des données personnelles requis",
        code: "PERSONAL_DATA_CONSENT_REQUIRED",
      });
    }

    const hasEmailField = Object.prototype.hasOwnProperty.call(req.body || {}, "email");
    const normalizedEmail = normalizeEmail(email);

    if (normalizedEmail === "__INVALID_EMAIL__") {
      return res.status(400).json({ error: "Format email invalide" });
    }

    const normalizedPaymentMode = paymentMode
      ? String(paymentMode).trim().toUpperCase()
      : null;

    const effectivePaymentMode =
      normalizedPaymentMode ||
      String(preorder.preorderPaymentMode || "").trim().toUpperCase() ||
      null;

    // Le mode de livraison n'est plus collecté à l'identification : il peut
    // arriver ici pour la première fois, depuis le récapitulatif.
    const requestedDeliveryMode = deliveryMode
      ? String(deliveryMode).trim().toUpperCase()
      : preorder.deliveryMode;

    const normalizedDeliveryMode = resolveDeliveryModeForPayment(
      effectivePaymentMode,
      requestedDeliveryMode,
    );

    if (!normalizedDeliveryMode) {
      return res
        .status(400)
        .json({ error: "Le mode de livraison est obligatoire." });
    }

    const optionValidation = validateCountryOrderOptions({
      settings: preorder.country?.settings,
      paymentMode: effectivePaymentMode,
      deliveryMode: normalizedDeliveryMode,
      requirePaymentMode: true,
      requireDeliveryMode: true,
    });

    if (!optionValidation.ok) {
      return res.status(400).json({
        error: optionValidation.message,
        code: optionValidation.code,
      });
    }

    if (
      (hasEmailField && normalizedEmail !== preorder.fboEmail) ||
      (normalizedPaymentMode &&
        normalizedPaymentMode !==
          String(preorder.preorderPaymentMode || "").trim().toUpperCase()) ||
      normalizedDeliveryMode !== preorder.deliveryMode ||
      (requestedConsentAccepted && !preorder.personalDataConsentAccepted)
    ) {
      const consentVersion =
        String(personalDataConsentVersion || DATA_PROTECTION_CONSENT_VERSION).trim() ||
        DATA_PROTECTION_CONSENT_VERSION;

      const updatedPreorder = await prisma.preorder.update({
        where: { id: preorder.id },
        data: {
          ...(hasEmailField ? { fboEmail: normalizedEmail } : {}),
          ...(normalizedPaymentMode
            ? { preorderPaymentMode: normalizedPaymentMode }
            : {}),
          deliveryMode: normalizedDeliveryMode,
          ...(requestedConsentAccepted && !preorder.personalDataConsentAccepted
            ? {
                personalDataConsentAccepted: true,
                personalDataConsentAcceptedAt: new Date(),
                personalDataConsentVersion: consentVersion,
              }
            : {}),
        },
      });

      preorder.fboEmail = updatedPreorder.fboEmail;
      preorder.preorderPaymentMode = updatedPreorder.preorderPaymentMode;
      preorder.deliveryMode = updatedPreorder.deliveryMode;
      preorder.personalDataConsentAccepted = updatedPreorder.personalDataConsentAccepted;
    }

    const smsTo = normalizePhoneForCountry(
      phoneNormalized || phoneRaw,
      preorder.country?.code || req.country?.code || "CIV",
    );
    if (!smsTo) {
      return res.status(400).json({ error: "Le numéro de téléphone est obligatoire." });
    }
    if (isBillingNumber(smsTo)) {
      return res.status(400).json({
        error:
          "Le numéro de téléphone client est invalide. Veuillez saisir le numéro de l'utilisateur.",
      });
    }

    const summary = await computePreorderTotals(preorderId, countryId);

    if (!summary.items || summary.items.length === 0) {
      return res
        .status(400)
        .json({ error: "Panier vide. Ajoute au moins 1 article." });
    }

    const minCartFcfa = Number(preorder.country?.settings?.minCartFcfa ?? 0);

    if (Number(summary.totals.totalFcfa || 0) < minCartFcfa) {
      return res.status(400).json({
        error: `Montant minimum non atteint. Minimum requis: ${minCartFcfa} FCFA.`,
      });
    }

    const timeoutMin = preorder.country?.settings?.billingClaimTimeoutMin || 30;
    const now = new Date();
    const sla = new Date(now.getTime() + timeoutMin * 60 * 1000);

    const smsMessage = buildPreorderSmsMessage({
      preorder: summary.preorder,
      totals: summary.totals,
    });

    const notificationResult = await sendPreorderNotification({
      preorder: {
        ...summary.preorder,
        factureWhatsappTo: smsTo,
        fboEmail: preorder.fboEmail || null,
        countryId: preorder.countryId || null,
      },
      purpose: "PREORDER_SUBMITTED",
      message: smsMessage,
      actorName: "SYSTEM",
      toPhone: smsTo,
    });
    const smsDispatched = Boolean(notificationResult?.smsSent);
    const smsQueued = Boolean(notificationResult?.smsQueued);
    console.log("[preorders][submit] notification dispatch result", {
      preorderId,
      smsTo,
      sent: notificationResult.sent,
      smsSent: smsDispatched,
      emailSent: Boolean(notificationResult?.emailSent),
      channel: notificationResult.channel,
      provider: notificationResult.provider,
      error: notificationResult.errorMessage || null,
    });

    const persistedMessageStatus = smsDispatched
      ? "SENT"
      : smsQueued
        ? "QUEUED"
        : "FAILED";
    const uiSmsStatus = smsDispatched ? "sent" : smsQueued ? "pending" : "failed";

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
              Number(it.discountPercent != null ? it.discountPercent : 0).toFixed(2),
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
          clientSubmissionKey,
          paymentStatus: "UNPAID",
          billingWorkStatus: "QUEUED",
          billingQueueEnteredAt: now,
          billingSlaDeadlineAt: sla,
          totalCc: String(Number(summary.totals.totalCc || 0).toFixed(3)),
          totalPoidsKg: String(Number(summary.totals.totalPoidsKg || 0).toFixed(3)),
          totalProduitsFcfa: summary.totals.totalProduitsFcfa || 0,
          fraisLivraisonFcfa: summary.totals.fraisLivraisonFcfa || 0,
          totalFcfa: summary.totals.totalFcfa || 0,
          factureWhatsappTo: smsTo,
          whatsappMessage: smsMessage,
          lastWhatsappStatus: persistedMessageStatus,
          lastWhatsappStatusAt: now,
          lastWhatsappMessageId: notificationResult.providerMessageId || null,
          submittedAt: now,
        },
      });

      await tx.preorderLog.create({
        data: {
          preorderId,
          action: "SUBMIT",
          note: "Précommande soumise",
          meta: {
            preorderNumber:
              summary?.preorder?.preorderNumber || preorder.preorderNumber,
            preorderPaymentMode:
              summary?.preorder?.preorderPaymentMode ||
              preorder.preorderPaymentMode ||
              null,
            totalFcfa: summary.totals.totalFcfa || 0,
            itemsCount: summary.items.length,
            smsTo,
            smsStatus: uiSmsStatus,
            smsProvider: notificationResult.provider,
            smsError: notificationResult.errorMessage || null,
            notificationChannel: notificationResult.channel || null,
            notificationAttempts: notificationResult.attempts || [],
          },
        },
      });

      await tx.preorderLog.create({
        data: {
          preorderId,
          action: "ENQUEUE_BILLING",
          note: "Précommande ajoutée à la file de facturation",
          meta: {
            billingWorkStatus: "QUEUED",
            billingSlaDeadlineAt: sla.toISOString(),
          },
        },
      });
    });

    publishRealtimeEvent({
      countryId: preorder.countryId || req.countryId,
      eventKey: "billing_queue_new",
      orderId: preorderId,
      meta: {
        status: "SUBMITTED",
        billingWorkStatus: "QUEUED",
        assignedInvoicerId: null,
        autoAssigned: false,
      },
    });

    return res.json({
      preorderId,
      preorderNumber:
        summary?.preorder?.preorderNumber || preorder.preorderNumber,
      status: "SUBMITTED",
      billingWorkStatus: "QUEUED",
      assignedInvoicerId: null,
      totals: summary.totals,
      smsTo,
      smsStatus: uiSmsStatus,
      smsLastError: notificationResult.errorMessage || null,
      smsLastSentAt: smsDispatched ? now.toISOString() : null,
      notificationChannel: notificationResult.channel || null,
      notificationAttempts: notificationResult.attempts || [],
    });
  } catch (e) {
    if (e?.code === "P2002" && clientSubmissionKey) {
      const existing = await prisma.preorder.findFirst({
        where: {
          countryId,
          clientSubmissionKey,
        },
      });
      if (existing) {
        return res.json(serializeExistingPreorder(existing));
      }
    }
    if (String(e.message) === "PRODUCT_GRADE_PRICE_MISSING") {
      return res.status(400).json({
        error:
          "Un ou plusieurs produits n'ont pas encore de prix par grade pour ce catalogue pays.",
      });
    }
    return res.status(500).json({ error: e.message || "Erreur submit" });
  }
}

async function notifySms(req, res) {
  const preorderId = req.params.id;
  const { phoneRaw, phoneNormalized } = req.body || {};

  try {
    const preorder = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id: preorderId }),
      include: {
        country: true,
      },
    });

    if (!preorder) {
      return res.status(404).json({ error: "Preorder not found" });
    }

    if (!["SUBMITTED", "INVOICED", "PAYMENT_PENDING"].includes(String(preorder.status || ""))) {
      return res.status(400).json({ error: "Précommande non éligible au renvoi SMS." });
    }

    const smsTo = normalizePhoneForCountry(
      phoneNormalized || phoneRaw || preorder.factureWhatsappTo,
      preorder.country?.code || req.country?.code || "CIV",
    );
    if (!smsTo) {
      return res.status(400).json({ error: "Aucun numéro disponible pour le SMS." });
    }
    if (isBillingNumber(smsTo)) {
      return res.status(400).json({
        error:
          "Le numéro de téléphone client est invalide. Veuillez saisir le numéro de l'utilisateur.",
      });
    }

    const smsMessage =
      preorder.whatsappMessage ||
      buildPreorderSmsMessage({
        preorder,
        totals: {
          totalFcfa: preorder.totalFcfa,
        },
      });

    const now = new Date();
    const notificationResult = await sendPreorderNotification({
      preorder: {
        ...preorder,
        factureWhatsappTo: smsTo,
      },
      purpose: "REMINDER",
      message: smsMessage,
      actorName: "SYSTEM",
      toPhone: smsTo,
    });
    const smsDispatched = Boolean(notificationResult?.smsSent);
    const smsQueued = Boolean(notificationResult?.smsQueued);
    console.log("[preorders][notifySms] notification dispatch result", {
      preorderId,
      smsTo,
      sent: notificationResult.sent,
      smsSent: smsDispatched,
      emailSent: Boolean(notificationResult?.emailSent),
      channel: notificationResult.channel,
      provider: notificationResult.provider,
      error: notificationResult.errorMessage || null,
    });

    const persistedMessageStatus = smsDispatched
      ? "SENT"
      : smsQueued
        ? "QUEUED"
        : "FAILED";
    const uiSmsStatus = smsDispatched ? "sent" : smsQueued ? "pending" : "failed";

    await prisma.$transaction(async (tx) => {
      await tx.preorder.update({
        where: { id: preorder.id },
        data: {
          factureWhatsappTo: smsTo,
          whatsappMessage: smsMessage,
          lastWhatsappStatus: persistedMessageStatus,
          lastWhatsappStatusAt: now,
          lastWhatsappMessageId: notificationResult.providerMessageId || null,
        },
      });

      await tx.preorderLog.create({
        data: {
          preorderId: preorder.id,
          action: "PAYMENT_PENDING",
          note: smsDispatched
            ? "SMS renvoyé"
            : smsQueued
              ? "SMS ajouté à la file d'envoi"
              : "Échec du renvoi SMS",
          meta: {
            smsTo,
            smsStatus: uiSmsStatus,
            smsProvider: notificationResult.provider,
            smsError: notificationResult.errorMessage || null,
            notificationChannel: notificationResult.channel || null,
            notificationAttempts: notificationResult.attempts || [],
          },
        },
      });
    });

    return res.json({
      preorderId: preorder.id,
      smsTo,
      smsStatus: uiSmsStatus,
      smsLastError: notificationResult.errorMessage || null,
      smsLastSentAt: smsDispatched ? now.toISOString() : null,
      notificationChannel: notificationResult.channel || null,
      notificationAttempts: notificationResult.attempts || [],
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Erreur notifySms" });
  }
}

async function getSmsStatus(req, res) {
  const preorderId = req.params.id;

  try {
    const preorder = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id: preorderId }),
      select: {
        id: true,
        lastWhatsappMessageId: true,
        lastWhatsappStatus: true,
        lastWhatsappStatusAt: true,
        factureWhatsappTo: true,
        country: {
          select: { code: true },
        },
      },
    });

    if (!preorder) {
      return res.status(404).json({ error: "Preorder not found" });
    }

    const resourceUrl = preorder.lastWhatsappMessageId;
    if (!resourceUrl || !String(resourceUrl).startsWith("http")) {
      return res.json({
        preorderId: preorder.id,
        smsTo: preorder.factureWhatsappTo || null,
        smsStatus: mapSmsStatus(preorder.lastWhatsappStatus),
        smsProviderStatus: preorder.lastWhatsappStatus || null,
        smsLastSentAt: preorder.lastWhatsappStatusAt || null,
        source: "db_only",
      });
    }

    const statusResult = await fetchSmsStatus({
      resourceUrl,
      countryCode: preorder.country?.code || req.country?.code || "CIV",
    });
    const now = new Date();

    let smsStatus = mapSmsStatus(preorder.lastWhatsappStatus);
    let smsProviderStatus = preorder.lastWhatsappStatus || null;
    let smsLastSentAt = preorder.lastWhatsappStatusAt || null;

    if (statusResult.ok) {
      const persisted = mapDeliveryToPersistedStatus(statusResult.deliveryStatus);
      if (persisted) {
        await prisma.preorder.update({
          where: { id: preorder.id },
          data: {
            lastWhatsappStatus: persisted,
            lastWhatsappStatusAt: now,
          },
        });
        smsStatus = mapSmsStatus(persisted);
        smsProviderStatus = statusResult.providerStatus || persisted;
        smsLastSentAt = now;
      } else {
        smsStatus = statusResult.deliveryStatus === "unknown" ? smsStatus : statusResult.deliveryStatus;
        smsProviderStatus = statusResult.providerStatus || smsProviderStatus;
      }
    }

    return res.json({
      preorderId: preorder.id,
      smsTo: preorder.factureWhatsappTo || null,
      smsStatus,
      smsProviderStatus,
      smsLastSentAt,
      smsLastError: statusResult.ok ? null : statusResult.error || null,
      source: statusResult.ok ? "orange_status_api" : "orange_status_api_error",
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Erreur getSmsStatus" });
  }
}

module.exports = {
  createDraft,
  checkFboDirectory,
  getCatalog,
  setItems,
  getSummary,
  submit,
  notifySms,
  getSmsStatus,
};
