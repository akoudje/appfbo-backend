const crypto = require("crypto");
const prisma = require("../../prisma");
const { sendSms } = require("../../services/sms.service");
const externalWavePaymentService = require("../../services/external-wave-payment.service");

const ALLOWED_STATUSES = new Set(["DRAFT", "ACTIVE", "PAID", "CANCELLED", "EXPIRED"]);

function generateToken() {
  return crypto.randomBytes(24).toString("base64url");
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
  const amount = Number.parseInt(value, 10);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
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
    return res.json({ url, countryCode });
  } catch (error) {
    console.error("externalPaymentLinks.getQrConfig error:", error);
    return res.status(500).json({ message: "Erreur serveur (getQrConfig)" });
  }
}

function buildSmsMessage(link, req) {
  const reference = link.invoiceReference || link.reference || "Paiement";
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
    publicUrl: publicUrl(req, link.token),
  };
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
    const { q, status } = req.query;
    const where = { countryId: req.countryId };
    if (status && ALLOWED_STATUSES.has(String(status).toUpperCase())) {
      where.status = String(status).toUpperCase();
    }
    if (q && String(q).trim()) {
      const term = String(q).trim();
      where.OR = [
        { reference: { contains: term, mode: "insensitive" } },
        { externalReference: { contains: term, mode: "insensitive" } },
        { invoiceReference: { contains: term, mode: "insensitive" } },
        { source: { contains: term, mode: "insensitive" } },
        { customerName: { contains: term, mode: "insensitive" } },
        { customerPhone: { contains: term, mode: "insensitive" } },
        { customerFboNumber: { contains: term, mode: "insensitive" } },
      ];
    }

    const links = await prisma.externalPaymentLink.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: 200,
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
        updatedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    return res.json({ data: links.map((link) => serialize(link, req)) });
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
    if (!customerPhone) return res.status(400).json({ message: "Numéro de téléphone obligatoire." });
    if (!baseAmountFcfa) return res.status(400).json({ message: "Montant sans frais invalide." });
    const serviceFeeFcfa = computeWaveFee(baseAmountFcfa);
    const amountFcfa = baseAmountFcfa + serviceFeeFcfa;
    const customerName = normalizeText(body.customerName, customerPhone);

    const paymentMethod = "WAVE";

    const reference = normalizeOptionalText(body.reference) || (await nextReference(req.countryId));
    const status = normalizeOptionalText(body.status) || "ACTIVE";
    if (!ALLOWED_STATUSES.has(status)) return res.status(400).json({ message: "Statut invalide." });

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
        expiresAt: null,
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
    const existing = await prisma.externalPaymentLink.findFirst({
      where: { id: req.params.id, countryId: req.countryId },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
        updatedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!existing) return res.status(404).json({ message: "Lien externe introuvable." });
    if (existing.status !== "ACTIVE") {
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

    const data = {
      status,
      updatedById: req.user?.id || null,
    };
    if (status === "PAID") data.paidAt = existing.paidAt || new Date();
    if (status === "CANCELLED") data.cancelledAt = existing.cancelledAt || new Date();

    const updated = await prisma.externalPaymentLink.update({
      where: { id: existing.id },
      data,
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
        ],
      },
      select: { id: true, preorderId: true },
    });

    if (existingPayment && existingPayment.preorderId !== order.id) {
      return res.status(409).json({
        message: "Cette transaction Wave est déjà rattachée à une autre commande.",
      });
    }

    const paidAt = link.paidAt || new Date();
    const amountPaidFcfa = Number(link.amountFcfa || 0);
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
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
    });

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
    return res.status(error.statusCode || 500).json({
      message: error.message || "Erreur serveur (attachToOrder)",
    });
  }
}

module.exports = {
  getQrConfig,
  listLinks,
  createLink,
  resendSms,
  syncWave,
  updateStatus,
  attachToOrder,
};
