const crypto = require("crypto");
const prisma = require("../../prisma");
const { sendSms } = require("../../services/sms.service");
const externalWavePaymentService = require("../../services/external-wave-payment.service");
const { Prisma } = require("@prisma/client");
const { resolveOrderSearchIds } = require("../../helpers/preorder-search");
const { parsePreorderNumbers } = require("../../services/settlement.service");

const ALLOWED_STATUSES = new Set(["DRAFT", "ACTIVE", "PAID", "CANCELLED", "EXPIRED"]);
const ALLOWED_SOURCES = new Set(["ADMIN", "QR_FORM"]);
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const EXPIRY_SOON_HOURS = 2;

function parseDateBoundary(value, endOfDay = false) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  const date = new Date(`${normalized}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isTruthyFlag(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function generateToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function normalizePagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE),
  );
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function normalizeExpiresAt(body = {}) {
  const explicit = normalizeOptionalText(body.expiresAt);
  if (explicit) {
    const date = new Date(explicit);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const hours = Number.parseFloat(body.expiresInHours);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeAmount(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function computeWaveFee(baseAmountFcfa) {
  return Math.ceil(Number(baseAmountFcfa || 0) * 0.01);
}

function formatAmount(value) {
  return `${Number(value || 0).toLocaleString("fr-FR")} FCFA`;
}

function publicUrl(req, token) {
  const configured = String(
    process.env.PUBLIC_APP_URL ||
      process.env.APP_PUBLIC_BASE_URL ||
      process.env.FRONTEND_URL ||
      "",
  ).trim();
  const rawBase = configured || `${req.protocol}://${req.get("host")}`;
  const base = /^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`;
  return `${base.replace(/\/+$/, "")}/external-payment/${encodeURIComponent(token)}`;
}

function publicBaseUrl(req) {
  const configured = String(
    process.env.PUBLIC_APP_URL ||
      process.env.APP_PUBLIC_BASE_URL ||
      process.env.FRONTEND_URL ||
      "",
  ).trim();
  const rawBase = configured || `${req.protocol}://${req.get("host")}`;
  const base = /^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`;
  return base.replace(/\/+$/, "");
}

function qrAccessToken() {
  return String(
    process.env.EXTERNAL_PAYMENT_QR_ACCESS_TOKEN ||
      process.env.EXTERNAL_PAYMENT_QR_ACCESS_TOKENS ||
      "",
  )
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)[0] || "";
}

async function getQrConfig(req, res) {
  try {
    const token = qrAccessToken();
    if (!token) {
      return res.status(500).json({
        message: "EXTERNAL_PAYMENT_QR_ACCESS_TOKEN n'est pas configuré.",
      });
    }
    const countryCode = req.country?.code || "CIV";
    const url = `${publicBaseUrl(req)}/pay/wave?countryCode=${encodeURIComponent(countryCode)}&access=${encodeURIComponent(token)}`;
    const directUrl = `${url}&direct=1`;
    return res.json({ url, directUrl, countryCode });
  } catch (error) {
    console.error("externalPaymentLinks.getQrConfig error:", error);
    return res.status(500).json({ message: "Erreur serveur (getQrConfig)" });
  }
}

function buildSmsMessage(link, req) {
  // Pas de référence facture AS400 dans le SMS client : référence du lien uniquement.
  const reference = link.reference || "Paiement";
  return `FOREVER: ${reference}. ${formatAmount(link.amountFcfa)}. Wave: ${publicUrl(req, link.token)}`;
}

async function sendExternalLinkSms({ link, req, phoneOverride = null }) {
  const to = normalizeOptionalText(phoneOverride) || link.customerPhone;
  if (!to) {
    return {
      accepted: false,
      provider: "ORANGE",
      errorCode: "PHONE_REQUIRED",
      errorMessage: "Numéro de téléphone obligatoire pour l'envoi SMS.",
      link,
    };
  }

  const result = await sendSms({
    to,
    message: buildSmsMessage(link, req),
    callbackData: `external-link-${link.id}`,
    countryCode: req.country?.code || "CIV",
  });

  const updated = await prisma.externalPaymentLink.update({
    where: { id: link.id },
    data: {
      smsTo: to,
      smsStatus: result?.accepted ? "SENT" : "FAILED",
      smsProvider: result?.provider || "ORANGE",
      smsProviderMessageId: result?.providerMessageId || null,
      smsLastError: result?.accepted
        ? null
        : result?.errorMessage || result?.errorCode || "Échec envoi SMS",
      smsLastSentAt: result?.accepted ? new Date() : null,
      smsSendCount: { increment: 1 },
      updatedById: req.user?.id || null,
    },
    include: {
      createdBy: { select: { id: true, fullName: true, email: true } },
      updatedBy: { select: { id: true, fullName: true, email: true } },
    },
  });

  return { ...result, link: updated };
}

function serializeSmsResult(result) {
  if (!result) return null;
  return {
    accepted: Boolean(result.accepted),
    provider: result.provider || null,
    errorCode: result.errorCode || null,
    errorMessage: result.errorMessage || null,
  };
}

function serialize(link, req) {
  if (!link) return link;
  return {
    ...link,
    status: link.status === "ACTIVE" && link.expiresAt && new Date(link.expiresAt) <= new Date() ? "EXPIRED" : link.status,
    publicUrl: publicUrl(req, link.token),
  };
}

// Un paiement groupé (un QR réglant plusieurs commandes) crée un Payment par
// commande : la clé `external:<link>` du rattachement simple ne pouvant être
// portée qu'une fois (@@unique provider/clientReference), chaque part reçoit
// `external:<link>:<commande>`.
function groupClientReferencePrefix(link) {
  return `external:${link.id}:`;
}

async function nextReference(countryId) {
  const today = new Date();
  const ymd = today.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `EXT-${ymd}`;
  const count = await prisma.externalPaymentLink.count({
    where: {
      countryId,
      reference: { startsWith: prefix },
    },
  });
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

async function listLinks(req, res) {
  try {
    const { q, status, source, createdFrom, createdTo } = req.query;
    const watchOnly = isTruthyFlag(req.query.watch);
    const where = { countryId: req.countryId };

    if (watchOnly) {
      // "À surveiller" prime sur le filtre de statut : uniquement les liens
      // actifs déjà expirés ou sur le point de l'être.
      where.status = "ACTIVE";
      where.expiresAt = {
        not: null,
        lte: new Date(Date.now() + EXPIRY_SOON_HOURS * 60 * 60 * 1000),
      };
    } else if (String(status).toUpperCase() === "EXPIRED") {
      where.OR = [{ status: "EXPIRED" }, { status: "ACTIVE", expiresAt: { lte: new Date() } }];
    } else if (status && ALLOWED_STATUSES.has(String(status).toUpperCase())) {
      where.status = String(status).toUpperCase();
      if (where.status === "ACTIVE") where.OR = [{ expiresAt: null }, { expiresAt: { gt: new Date() } }];
    }

    if (source && (ALLOWED_SOURCES.has(String(source).toUpperCase()) || String(source).toUpperCase() === "SHIPPING")) {
      where.source = String(source).toUpperCase();
    }

    const createdFromDate = parseDateBoundary(createdFrom, false);
    const createdToDate = parseDateBoundary(createdTo, true);
    if (createdFromDate || createdToDate) {
      where.createdAt = {
        ...(createdFromDate ? { gte: createdFromDate } : {}),
        ...(createdToDate ? { lte: createdToDate } : {}),
      };
    }

    if (q && String(q).trim()) {
      const term = String(q).trim();
      where.AND = [{ OR: [
        { reference: { contains: term, mode: "insensitive" } },
        { externalReference: { contains: term, mode: "insensitive" } },
        { invoiceReference: { contains: term, mode: "insensitive" } },
        { source: { contains: term, mode: "insensitive" } },
        { customerName: { contains: term, mode: "insensitive" } },
        { customerPhone: { contains: term, mode: "insensitive" } },
        { customerFboNumber: { contains: term, mode: "insensitive" } },
      ] }];
    }

    const { page, pageSize, skip, take } = normalizePagination(req.query);

    const [total, activeCount, paidAgg, links] = await Promise.all([
      prisma.externalPaymentLink.count({ where }),
      prisma.externalPaymentLink.count({ where: { AND: [where, { status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }] } }),
      prisma.externalPaymentLink.aggregate({
        where: { AND: [where, { status: "PAID" }] },
        _count: { _all: true },
        _sum: { amountFcfa: true },
      }),
      prisma.externalPaymentLink.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip,
        take,
        include: {
          createdBy: { select: { id: true, fullName: true, email: true } },
          updatedBy: { select: { id: true, fullName: true, email: true } },
        },
      }),
    ]);
    const attachedPayments = await prisma.payment.findMany({
      where: { countryId: req.countryId, provider: "WAVE", clientReference: { in: links.map((link) => `external:${link.id}`) } },
      select: { clientReference: true, preorder: { select: { id: true, preorderNumber: true } } },
    });
    const attachedByReference = new Map(attachedPayments.map((payment) => [payment.clientReference, payment.preorder]));
    const groupPayments = links.length
      ? await prisma.payment.findMany({
          where: {
            countryId: req.countryId,
            provider: "WAVE",
            OR: links.map((link) => ({ clientReference: { startsWith: groupClientReferencePrefix(link) } })),
          },
          select: { clientReference: true, preorder: { select: { id: true, preorderNumber: true } } },
        })
      : [];
    const groupByLink = new Map();
    for (const payment of groupPayments) {
      const linkId = String(payment.clientReference).split(":")[1];
      if (!groupByLink.has(linkId)) groupByLink.set(linkId, []);
      groupByLink.get(linkId).push(payment.preorder);
    }
    return res.json({
      data: links.map((link) => serialize({
        ...link,
        attachedOrder: attachedByReference.get(`external:${link.id}`) || null,
        attachedOrders: groupByLink.get(link.id) || [],
      }, req)),
      total,
      page,
      pageSize,
      stats: {
        activeCount,
        paidCount: paidAgg._count._all,
        paidAmountFcfa: paidAgg._sum.amountFcfa || 0,
      },
    });
  } catch (error) {
    console.error("externalPaymentLinks.listLinks error:", error);
    return res.status(500).json({ message: "Erreur serveur (listLinks)" });
  }
}

async function createLink(req, res) {
  try {
    const body = req.body || {};
    const invoiceReference = normalizeOptionalText(body.invoiceReference);
    const customerPhone = normalizeOptionalText(body.customerPhone);
    const baseAmountFcfa = normalizeAmount(
      body.baseAmountFcfa ?? body.amountWithoutFeesFcfa ?? body.amountFcfa,
    );
    if (!invoiceReference) return res.status(400).json({ message: "Référence facture obligatoire." });
    if (!customerPhone || !/^\+?\d{8,15}$/.test(customerPhone.replace(/[\s().-]/g, ""))) return res.status(400).json({ message: "Numéro de téléphone invalide (8 à 15 chiffres)." });
    if (!baseAmountFcfa || baseAmountFcfa + computeWaveFee(baseAmountFcfa) > 2147483647) return res.status(400).json({ message: "Montant sans frais invalide." });
    const serviceFeeFcfa = computeWaveFee(baseAmountFcfa);
    const amountFcfa = baseAmountFcfa + serviceFeeFcfa;
    const customerName = normalizeText(body.customerName, customerPhone);

    const paymentMethod = "WAVE";

    const status = normalizeOptionalText(body.status) || "ACTIVE";
    if (!["ACTIVE", "DRAFT"].includes(status)) return res.status(400).json({ message: "Un nouveau lien doit être actif ou en brouillon." });
    const reference = normalizeOptionalText(body.reference) || (await nextReference(req.countryId));

    const link = await prisma.externalPaymentLink.create({
      data: {
        countryId: req.countryId,
        token: generateToken(),
        reference,
        externalReference: normalizeOptionalText(body.externalReference),
        invoiceReference,
        source: normalizeOptionalText(body.source) || "ADMIN",
        customerName,
        customerPhone,
        customerEmail: normalizeOptionalText(body.customerEmail)?.toLowerCase() || null,
        customerFboNumber: normalizeOptionalText(body.customerFboNumber),
        baseAmountFcfa,
        serviceFeeFcfa,
        amountFcfa,
        paymentMethod,
        provider: "WAVE",
        status,
        title: normalizeOptionalText(body.title),
        description: normalizeOptionalText(body.description),
        instructions: normalizeOptionalText(body.instructions),
        expiresAt: normalizeExpiresAt(body),
        createdById: req.user?.id || null,
        updatedById: req.user?.id || null,
      },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
        updatedBy: { select: { id: true, fullName: true, email: true } },
      },
    });

    const smsResult = await sendExternalLinkSms({ link, req });
    return res.status(201).json({
      ...serialize(smsResult.link || link, req),
      smsResult: serializeSmsResult(smsResult),
    });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ message: "Cette référence existe déjà." });
    }
    if (
      error?.code === "P2022" ||
      /column .*does not exist/i.test(String(error?.message || ""))
    ) {
      console.error("externalPaymentLinks.createLink migration error:", {
        code: error?.code,
        message: error?.message,
      });
      return res.status(500).json({
        message:
          "La base de données n'est pas à jour pour les liens Wave externes. Exécutez les migrations Prisma.",
      });
    }
    console.error("externalPaymentLinks.createLink error:", error);
    return res.status(500).json({ message: "Erreur serveur (createLink)" });
  }
}

async function resendSms(req, res) {
  try {
    const phone = normalizeOptionalText(req.body?.phone);
    if (phone && !/^\+?\d{8,15}$/.test(phone.replace(/[\s().-]/g, ""))) return res.status(400).json({ message: "Numéro de téléphone invalide (8 à 15 chiffres)." });
    const existing = await prisma.externalPaymentLink.findFirst({
      where: { id: req.params.id, countryId: req.countryId },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
        updatedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!existing) return res.status(404).json({ message: "Lien externe introuvable." });
    if (existing.status !== "ACTIVE" || (existing.expiresAt && new Date(existing.expiresAt) <= new Date())) {
      return res.status(400).json({ message: "Seuls les liens actifs peuvent être renvoyés par SMS." });
    }

    const smsResult = await sendExternalLinkSms({
      link: existing,
      req,
      phoneOverride: req.body?.phone,
    });

    return res.json({
      ...serialize(smsResult.link || existing, req),
      smsResult: serializeSmsResult(smsResult),
    });
  } catch (error) {
    console.error("externalPaymentLinks.resendSms error:", error);
    return res.status(500).json({ message: "Erreur serveur (resendSms)" });
  }
}

async function syncWave(req, res) {
  try {
    const existing = await prisma.externalPaymentLink.findFirst({
      where: { id: req.params.id, countryId: req.countryId },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
        updatedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!existing) return res.status(404).json({ message: "Lien externe introuvable." });
    if (!existing.providerSessionId) {
      return res.status(400).json({ message: "Aucune session Wave n'est associée à ce lien." });
    }

    const result = await externalWavePaymentService.syncExternalWavePaymentLink(existing);
    return res.json(serialize(result.link || existing, req));
  } catch (error) {
    console.error("externalPaymentLinks.syncWave error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Erreur serveur (syncWave)",
    });
  }
}

async function updateStatus(req, res) {
  try {
    const status = normalizeOptionalText(req.body?.status);
    if (!ALLOWED_STATUSES.has(status)) return res.status(400).json({ message: "Statut invalide." });

    const existing = await prisma.externalPaymentLink.findFirst({
      where: { id: req.params.id, countryId: req.countryId },
    });
    if (!existing) return res.status(404).json({ message: "Lien externe introuvable." });

    if (existing.source === "SHIPPING") return res.status(409).json({ message: "Les frais d’expédition se gèrent dans la préparation de la commande." });
    if (status !== "CANCELLED" || !["DRAFT", "ACTIVE"].includes(existing.status)) {
      return res.status(409).json({ message: "Seul un lien non payé peut être annulé. La confirmation du paiement est réservée à Wave." });
    }
    const data = {
      status,
      updatedById: req.user?.id || null,
    };
    if (status === "CANCELLED") data.cancelledAt = existing.cancelledAt || new Date();

    const changed = await prisma.externalPaymentLink.updateMany({
      where: { id: existing.id, countryId: req.countryId, status: { in: ["DRAFT", "ACTIVE"] } }, data,
    });
    if (!changed.count) return res.status(409).json({ message: "Le statut du lien a changé. Actualisez la liste." });
    const updated = await prisma.externalPaymentLink.findFirst({
      where: { id: existing.id, countryId: req.countryId },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
        updatedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    return res.json(serialize(updated, req));
  } catch (error) {
    console.error("externalPaymentLinks.updateStatus error:", error);
    return res.status(500).json({ message: "Erreur serveur (updateStatus)" });
  }
}

async function findAttachOrders(req, res) {
  try {
    const q = normalizeOptionalText(req.query.q);
    if (!q || q.length < 2) return res.json({ data: [] });
    // Voir helpers/preorder-search.js : un OR multi-colonnes fait perdre ses
    // index trigram à Postgres, d'où la résolution des ids en amont.
    const matchedIds = await resolveOrderSearchIds({
      q,
      scopeSql: Prisma.sql`"countryId" = ${req.countryId}`,
    });
    const orders = matchedIds
      ? await prisma.preorder.findMany({
          where: {
            countryId: req.countryId,
            status: { notIn: ["CANCELLED", "PAID", "READY", "FULFILLED"] },
            paymentStatus: { not: "PAID" },
            id: { in: matchedIds },
          },
          select: { id: true, preorderNumber: true, factureReference: true, fboNomComplet: true, fboNumero: true, totalFcfa: true },
          take: 10, orderBy: { createdAt: "desc" },
        })
      : [];
    return res.json({ data: orders });
  } catch (error) {
    console.error("externalPaymentLinks.findAttachOrders error:", error);
    return res.status(500).json({ message: "Recherche des commandes impossible." });
  }
}

async function attachToOrder(req, res) {
  try {
    const preorderNumber = normalizeOptionalText(req.body?.preorderNumber);
    if (!preorderNumber) {
      return res.status(400).json({ message: "Numéro de commande requis." });
    }

    const link = await prisma.externalPaymentLink.findFirst({
      where: { id: req.params.id, countryId: req.countryId },
    });
    if (!link) return res.status(404).json({ message: "Lien externe introuvable." });

    if (link.source === "SHIPPING") return res.status(409).json({ message: "Ce paiement est réservé aux frais d’expédition et ne peut pas régler des produits." });
    if (link.status !== "PAID") {
      return res.status(400).json({
        message: "Seul un lien externe payé peut être rattaché à une commande.",
      });
    }

    const order = await prisma.preorder.findFirst({
      where: {
        countryId: req.countryId,
        preorderNumber,
      },
      select: {
        id: true,
        countryId: true,
        preorderNumber: true,
        status: true,
        paymentStatus: true,
        preorderPaymentMode: true,
        paymentProvider: true,
        totalFcfa: true,
        factureReference: true,
        billingCompletedAt: true,
      },
    });
    if (!order) return res.status(404).json({ message: "Commande introuvable." });

    const orderStatus = String(order.status || "").toUpperCase();
    const orderPaymentStatus = String(order.paymentStatus || "").toUpperCase();
    if (orderPaymentStatus === "PAID" || ["PAID", "READY", "FULFILLED"].includes(orderStatus)) {
      return res.status(400).json({
        message: "Cette commande est déjà soldée.",
      });
    }

    if (orderStatus === "CANCELLED") {
      return res.status(400).json({
        message: "Impossible de rattacher un paiement à une commande annulée.",
      });
    }

    const existingPayment = await prisma.payment.findFirst({
      where: {
        provider: "WAVE",
        OR: [
          ...(link.providerTransactionId
            ? [{ providerTxnId: link.providerTransactionId }]
            : []),
          { clientReference: `external:${link.id}` },
          { clientReference: { startsWith: groupClientReferencePrefix(link) } },
        ],
      },
      select: { id: true, preorderId: true, clientReference: true },
    });

    if (existingPayment?.clientReference?.startsWith(groupClientReferencePrefix(link))) {
      return res.status(409).json({
        message: "Ce paiement est déjà réparti sur plusieurs commandes.",
      });
    }

    if (existingPayment && existingPayment.preorderId !== order.id) {
      return res.status(409).json({
        message: "Cette transaction Wave est déjà rattachée à une autre commande.",
      });
    }

    const paidAt = link.paidAt || new Date();
    const amountPaidFcfa = Number(link.amountFcfa || 0);
    const invoiceAmountFcfa = Number(link.baseAmountFcfa || (amountPaidFcfa - Number(link.serviceFeeFcfa || 0)));
    if (!(invoiceAmountFcfa > 0) || invoiceAmountFcfa !== Number(order.totalFcfa)) {
      return res.status(409).json({ message: `Montant incompatible : facture ${formatAmount(order.totalFcfa)}, paiement hors frais ${formatAmount(invoiceAmountFcfa)}. Le rattachement est bloqué.` });
    }
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const currentOrder = await tx.preorder.findFirst({ where: { id: order.id, countryId: req.countryId } });
      const currentLink = await tx.externalPaymentLink.findFirst({ where: { id: link.id, countryId: req.countryId } });
      if (!currentOrder || !currentLink || currentLink.status !== "PAID" || currentOrder.paymentStatus === "PAID" || ["PAID", "READY", "FULFILLED", "CANCELLED"].includes(currentOrder.status) || Number(currentOrder.totalFcfa) !== invoiceAmountFcfa || Number(currentLink.amountFcfa) !== amountPaidFcfa || Number(currentLink.baseAmountFcfa || (currentLink.amountFcfa - Number(currentLink.serviceFeeFcfa || 0))) !== invoiceAmountFcfa) {
        throw Object.assign(new Error("La commande ou le paiement a changé. Actualisez avant de rattacher."), { statusCode: 409 });
      }
      let paymentId = existingPayment?.id || null;
      let attemptId = null;

      if (!paymentId) {
        const payment = await tx.payment.create({
          data: {
            preorderId: order.id,
            countryId: order.countryId,
            provider: "WAVE",
            methodType: "MOBILE_MONEY",
            status: "SUCCEEDED",
            amountExpectedFcfa: amountPaidFcfa,
            amountPaidFcfa,
            currencyCode: link.currencyCode || "XOF",
            providerReference: link.providerSessionId || link.reference,
            providerTxnId: link.providerTransactionId || null,
            clientReference: `external:${link.id}`,
            initiatedAt: link.createdAt || now,
            paidAt,
          },
        });
        paymentId = payment.id;

        const attempt = await tx.paymentAttempt.create({
          data: {
            paymentId,
            provider: "WAVE",
            status: "SUCCEEDED",
            providerSessionId: link.providerSessionId || null,
            providerTransactionId: link.providerTransactionId || null,
            providerPayerPhone: link.providerPayerPhone || link.customerPhone || null,
            providerStatusLabel: link.providerStatusLabel || null,
            checkoutUrl: link.providerCheckoutUrl || null,
            providerLaunchUrl: link.providerLaunchUrl || null,
            requestPayloadJson: {
              source: "EXTERNAL_PAYMENT_LINK_ATTACH",
              externalPaymentLinkId: link.id,
              externalPaymentReference: link.reference,
              externalInvoiceReference: link.invoiceReference,
            },
            responsePayloadJson: link.providerPayloadJson || null,
            normalizedPayloadJson: {
              externalPaymentLinkId: link.id,
              reference: link.reference,
              providerSessionId: link.providerSessionId || null,
              providerTransactionId: link.providerTransactionId || null,
              amountPaidFcfa,
              paidAt,
            },
            completedAt: paidAt,
          },
        });
        attemptId = attempt.id;

        await tx.payment.update({
          where: { id: paymentId },
          data: { lastAttemptId: attemptId },
        });
      }

      const updatedOrder = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paymentStatus: "PAID",
          preorderPaymentMode: "WAVE",
          paymentProvider: "WAVE",
          paidAt,
          activePaymentId: paymentId,
          billingWorkStatus: "COMPLETED",
          billingCompletedAt: order.billingCompletedAt || now,
          billingLastActivityAt: now,
        },
      });

      await tx.preorderLog.create({
        data: {
          preorderId: order.id,
          action: "PAYMENT_CONFIRMED",
          note: `Paiement externe ${link.reference} rattaché à la commande`,
          actorAdminId: req.user?.id || null,
          meta: {
            source: "EXTERNAL_PAYMENT_LINK_ATTACH",
            externalPaymentLinkId: link.id,
            externalPaymentReference: link.reference,
            externalInvoiceReference: link.invoiceReference,
            externalPublicUrl: publicUrl(req, link.token),
            providerSessionId: link.providerSessionId || null,
            providerTransactionId: link.providerTransactionId || null,
            amountPaidFcfa,
            orderTotalFcfa: Number(order.totalFcfa || 0),
            previousPreorderPaymentMode: order.preorderPaymentMode || null,
            previousPaymentProvider: order.paymentProvider || null,
            paymentId,
            paymentAttemptId: attemptId,
          },
        },
      });

      await tx.externalPaymentLink.update({
        where: { id: link.id },
        data: {
          updatedById: req.user?.id || null,
          description: [
            link.description,
            `Rattaché à la commande ${order.preorderNumber} le ${now.toISOString()}.`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      });

      return { order: updatedOrder, paymentId, paymentAttemptId: attemptId };
    }, { isolationLevel: "Serializable" });

    return res.json({
      ok: true,
      message: `Paiement ${link.reference} rattaché à ${order.preorderNumber}.`,
      link: serialize({ ...link, status: "PAID" }, req),
      order: result.order,
      paymentId: result.paymentId,
      paymentAttemptId: result.paymentAttemptId,
    });
  } catch (error) {
    console.error("externalPaymentLinks.attachToOrder error:", error);
    if (["P2034", "P2002"].includes(error.code)) return res.status(409).json({ message: "Ce paiement ou cette commande vient d’être modifié. Actualisez avant de réessayer." });
    return res.status(error.statusCode || 500).json({
      message: error.message || "Erreur serveur (attachToOrder)",
    });
  }
}

const MAX_GROUP_ORDERS = 100;

// Contrôles du rattachement groupé, partagés par l'aperçu (dryRun) et la
// confirmation : chaque commande doit exister, être non soldée et non réglée
// par une filiale, et la somme des factures doit égaler le paiement hors frais.
async function checkGroupAttach(db, req, link, numbers) {
  const orders = await db.preorder.findMany({
    where: { countryId: req.countryId, preorderNumber: { in: numbers } },
    select: {
      id: true,
      countryId: true,
      preorderNumber: true,
      factureReference: true,
      fboNomComplet: true,
      fboNumero: true,
      status: true,
      paymentStatus: true,
      preorderPaymentMode: true,
      paymentProvider: true,
      settlementEntity: true,
      totalFcfa: true,
      billingCompletedAt: true,
    },
  });
  const byNumber = new Map(orders.map((order) => [order.preorderNumber, order]));
  const issues = [];
  for (const number of numbers) {
    const order = byNumber.get(number);
    const status = String(order?.status || "").toUpperCase();
    if (!order) issues.push(`${number} : commande introuvable.`);
    else if (status === "CANCELLED") issues.push(`${number} : commande annulée.`);
    else if (order.paymentStatus === "PAID" || ["PAID", "READY", "FULFILLED"].includes(status)) issues.push(`${number} : déjà soldée.`);
    else if (order.settlementEntity) issues.push(`${number} : réglée par une autre filiale.`);
  }
  const ordersTotalFcfa = orders.reduce((sum, order) => sum + Number(order.totalFcfa || 0), 0);
  const invoiceAmountFcfa = Number(link.baseAmountFcfa || (Number(link.amountFcfa || 0) - Number(link.serviceFeeFcfa || 0)));
  if (!issues.length && ordersTotalFcfa !== invoiceAmountFcfa) {
    issues.push(`Montant incompatible : total des factures ${formatAmount(ordersTotalFcfa)}, paiement hors frais ${formatAmount(invoiceAmountFcfa)} (écart ${formatAmount(invoiceAmountFcfa - ordersTotalFcfa)}).`);
  }
  return {
    orders: numbers.map((number) => byNumber.get(number)).filter(Boolean),
    issues,
    ordersTotalFcfa,
    invoiceAmountFcfa,
  };
}

// POST /:id/attach-orders { text, dryRun } : un paiement QR réglant plusieurs
// commandes d'un coup (ex. un parrain qui paie pour son groupe à la caisse).
// `text` est la liste de n° de précommande collée telle quelle.
async function attachToOrders(req, res) {
  try {
    const { numbers, unrecognized } = parsePreorderNumbers(req.body?.text);
    const dryRun = req.body?.dryRun === true;
    if (!numbers.length) {
      return res.status(400).json({ message: "Aucun numéro de commande reconnu (format PO-CIV-AAAAMMJJ-0000)." });
    }
    if (numbers.length > MAX_GROUP_ORDERS) {
      return res.status(400).json({ message: `${MAX_GROUP_ORDERS} commandes maximum par paiement.` });
    }

    const link = await prisma.externalPaymentLink.findFirst({
      where: { id: req.params.id, countryId: req.countryId },
    });
    if (!link) return res.status(404).json({ message: "Lien externe introuvable." });
    if (link.source === "SHIPPING") return res.status(409).json({ message: "Ce paiement est réservé aux frais d’expédition et ne peut pas régler des produits." });
    if (link.status !== "PAID") {
      return res.status(400).json({ message: "Seul un lien externe payé peut être rattaché à des commandes." });
    }

    const alreadyAttached = await prisma.payment.findFirst({
      where: {
        provider: "WAVE",
        OR: [
          ...(link.providerTransactionId ? [{ providerTxnId: link.providerTransactionId }] : []),
          { clientReference: `external:${link.id}` },
          { clientReference: { startsWith: groupClientReferencePrefix(link) } },
        ],
      },
      select: { id: true },
    });
    if (alreadyAttached) {
      return res.status(409).json({ message: "Ce paiement est déjà rattaché à une ou plusieurs commandes." });
    }

    const check = await checkGroupAttach(prisma, req, link, numbers);
    const preview = {
      reference: link.reference,
      orders: check.orders,
      ordersTotalFcfa: check.ordersTotalFcfa,
      invoiceAmountFcfa: check.invoiceAmountFcfa,
      issues: check.issues,
      unrecognized,
    };
    if (dryRun || check.issues.length) {
      return res.status(dryRun ? 200 : 409).json({
        ok: !check.issues.length,
        ...preview,
        ...(check.issues.length && !dryRun ? { message: check.issues[0] } : {}),
      });
    }

    const paidAt = link.paidAt || new Date();
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      const currentLink = await tx.externalPaymentLink.findFirst({ where: { id: link.id, countryId: req.countryId } });
      const current = await checkGroupAttach(tx, req, link, numbers);
      if (!currentLink || currentLink.status !== "PAID" || current.issues.length) {
        throw Object.assign(new Error("Une commande ou le paiement a changé. Actualisez avant de rattacher."), { statusCode: 409 });
      }

      for (const order of current.orders) {
        const amountFcfa = Number(order.totalFcfa || 0);
        const payment = await tx.payment.create({
          data: {
            preorderId: order.id,
            countryId: order.countryId,
            provider: "WAVE",
            methodType: "MOBILE_MONEY",
            status: "SUCCEEDED",
            amountExpectedFcfa: amountFcfa,
            amountPaidFcfa: amountFcfa,
            currencyCode: link.currencyCode || "XOF",
            providerReference: link.providerSessionId || link.reference,
            // La transaction Wave est unique par Payment : elle reste sur le
            // lien et dans la tentative, pas sur chaque part.
            providerTxnId: null,
            clientReference: `${groupClientReferencePrefix(link)}${order.id}`,
            initiatedAt: link.createdAt || now,
            paidAt,
          },
        });

        const attempt = await tx.paymentAttempt.create({
          data: {
            paymentId: payment.id,
            provider: "WAVE",
            status: "SUCCEEDED",
            providerSessionId: link.providerSessionId || null,
            providerTransactionId: link.providerTransactionId || null,
            providerPayerPhone: link.providerPayerPhone || link.customerPhone || null,
            providerStatusLabel: link.providerStatusLabel || null,
            requestPayloadJson: {
              source: "EXTERNAL_PAYMENT_LINK_GROUP_ATTACH",
              externalPaymentLinkId: link.id,
              externalPaymentReference: link.reference,
              groupSize: current.orders.length,
            },
            normalizedPayloadJson: {
              externalPaymentLinkId: link.id,
              reference: link.reference,
              providerTransactionId: link.providerTransactionId || null,
              amountPaidFcfa: amountFcfa,
              paidAt,
            },
            completedAt: paidAt,
          },
        });

        await tx.payment.update({ where: { id: payment.id }, data: { lastAttemptId: attempt.id } });

        await tx.preorder.update({
          where: { id: order.id },
          data: {
            status: "PAID",
            paymentStatus: "PAID",
            preorderPaymentMode: "WAVE",
            paymentProvider: "WAVE",
            paidAt,
            activePaymentId: payment.id,
            billingWorkStatus: "COMPLETED",
            billingCompletedAt: order.billingCompletedAt || now,
            billingLastActivityAt: now,
          },
        });

        await tx.preorderLog.create({
          data: {
            preorderId: order.id,
            action: "PAYMENT_CONFIRMED",
            note: `Paiement groupé ${link.reference} (${current.orders.length} commandes) rattaché à la commande`,
            actorAdminId: req.user?.id || null,
            meta: {
              source: "EXTERNAL_PAYMENT_LINK_GROUP_ATTACH",
              externalPaymentLinkId: link.id,
              externalPaymentReference: link.reference,
              providerTransactionId: link.providerTransactionId || null,
              groupSize: current.orders.length,
              groupTotalFcfa: current.ordersTotalFcfa,
              orderTotalFcfa: amountFcfa,
              previousPreorderPaymentMode: order.preorderPaymentMode || null,
              previousPaymentProvider: order.paymentProvider || null,
              paymentId: payment.id,
              paymentAttemptId: attempt.id,
            },
          },
        });
      }

      await tx.externalPaymentLink.update({
        where: { id: link.id },
        data: {
          updatedById: req.user?.id || null,
          description: [
            link.description,
            `Réparti sur ${current.orders.length} commandes le ${now.toISOString()} : ${current.orders.map((order) => order.preorderNumber).join(", ")}.`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      });
    }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 60000 });

    return res.json({
      ok: true,
      ...preview,
      message: `Paiement ${link.reference} rattaché à ${check.orders.length} commandes.`,
    });
  } catch (error) {
    console.error("externalPaymentLinks.attachToOrders error:", error);
    if (["P2034", "P2002"].includes(error.code)) return res.status(409).json({ message: "Ce paiement ou une commande vient d’être modifié. Actualisez avant de réessayer." });
    return res.status(error.statusCode || 500).json({
      message: error.message || "Erreur serveur (attachToOrders)",
    });
  }
}

module.exports = {
  findAttachOrders,
  getQrConfig,
  listLinks,
  createLink,
  resendSms,
  syncWave,
  updateStatus,
  attachToOrder,
  attachToOrders,
};
