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

function buildSmsMessage(link, req) {
  const invoice = link.invoiceReference ? `Facture ${link.invoiceReference}` : "Paiement Forever";
  return `FOREVER: ${invoice}. Montant ${formatAmount(link.amountFcfa)}. Payez via Wave: ${publicUrl(req, link.token)}`;
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

module.exports = {
  listLinks,
  createLink,
  resendSms,
  syncWave,
  updateStatus,
};
