const prisma = require("../prisma");
const crypto = require("crypto");
const externalWavePaymentService = require("../services/external-wave-payment.service");

function generateToken() {
  return crypto.randomBytes(24).toString("base64url");
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

function qrAccessTokens() {
  return String(
    process.env.EXTERNAL_PAYMENT_QR_ACCESS_TOKEN ||
      process.env.EXTERNAL_PAYMENT_QR_ACCESS_TOKENS ||
      "",
  )
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function hasQrAccess(req) {
  const configured = qrAccessTokens();
  if (!configured.length) return false;
  const provided =
    normalizeOptionalText(req.body?.accessToken) ||
    normalizeOptionalText(req.query?.access) ||
    normalizeOptionalText(req.header("X-External-Payment-Access"));
  return Boolean(provided && configured.includes(provided));
}

async function nextReference(countryId) {
  const today = new Date();
  const ymd = today.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `QR-${ymd}`;
  const count = await prisma.externalPaymentLink.count({
    where: {
      countryId,
      reference: { startsWith: prefix },
    },
  });
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

function isExpired(link) {
  return link?.expiresAt && new Date(link.expiresAt).getTime() < Date.now();
}

async function createQrLink(req, res) {
  try {
    if (!hasQrAccess(req)) {
      return res.status(403).json({ message: "Accès non autorisé." });
    }

    const invoiceReference = normalizeOptionalText(req.body?.invoiceReference);
    const baseAmountFcfa = normalizeAmount(
      req.body?.baseAmountFcfa ?? req.body?.amountWithoutFeesFcfa ?? req.body?.amountFcfa,
    );
    const customerPhone = normalizeOptionalText(req.body?.customerPhone);
    const customerEmail = normalizeOptionalText(req.body?.customerEmail);
    const customerName = normalizeOptionalText(req.body?.customerName) || "Client hors précommande";

    if (!invoiceReference) {
      return res.status(400).json({ message: "Référence facture obligatoire." });
    }
    if (!baseAmountFcfa) {
      return res.status(400).json({ message: "Montant sans frais invalide." });
    }

    const serviceFeeFcfa = computeWaveFee(baseAmountFcfa);
    const amountFcfa = baseAmountFcfa + serviceFeeFcfa;

    const link = await prisma.externalPaymentLink.create({
      data: {
        countryId: req.countryId,
        token: generateToken(),
        reference: await nextReference(req.countryId),
        invoiceReference,
        source: "QR_FORM",
        customerName,
        customerPhone,
        customerEmail: customerEmail?.toLowerCase() || null,
        baseAmountFcfa,
        serviceFeeFcfa,
        amountFcfa,
        paymentMethod: "WAVE",
        provider: "WAVE",
        status: "ACTIVE",
        title: "Paiement commande Forever",
      },
    });

    return res.status(201).json({
      id: link.id,
      reference: link.reference,
      invoiceReference: link.invoiceReference,
      customerPhone: link.customerPhone,
      customerEmail: link.customerEmail,
      baseAmountFcfa: link.baseAmountFcfa,
      serviceFeeFcfa: link.serviceFeeFcfa,
      amountFcfa: link.amountFcfa,
      status: link.status,
      publicUrl: publicUrl(req, link.token),
    });
  } catch (error) {
    if (error?.code === "P2022" || /column .*does not exist/i.test(String(error?.message || ""))) {
      return res.status(500).json({
        message:
          "La base de données n'est pas à jour pour les liens QR. Exécutez les migrations Prisma.",
      });
    }
    console.error("externalPaymentLinks.createQrLink error:", error);
    return res.status(500).json({ message: "Erreur serveur (createQrLink)" });
  }
}

async function getPublicLink(req, res) {
  try {
    const token = String(req.params.token || "").trim();
    if (!token) return res.status(400).json({ message: "Token requis." });

    const link = await prisma.externalPaymentLink.findFirst({
      where: { token, countryId: req.countryId },
      include: {
        country: { select: { id: true, code: true, name: true, currencyCode: true } },
      },
    });
    if (!link) return res.status(404).json({ message: "Lien de paiement introuvable." });

    const effectiveStatus = isExpired(link) && link.status === "ACTIVE" ? "EXPIRED" : link.status;

    await prisma.externalPaymentLink.update({
      where: { id: link.id },
      data: {
        clickedAt: new Date(),
        clickCount: { increment: 1 },
        ...(effectiveStatus === "EXPIRED" ? { status: "EXPIRED" } : {}),
      },
    });

    return res.json({
      id: link.id,
      reference: link.reference,
      externalReference: link.externalReference,
      invoiceReference: link.invoiceReference,
      customerName: link.customerName,
      customerPhone: link.customerPhone,
      customerEmail: link.customerEmail,
      customerFboNumber: link.customerFboNumber,
      baseAmountFcfa: link.baseAmountFcfa,
      serviceFeeFcfa: link.serviceFeeFcfa,
      amountFcfa: link.amountFcfa,
      currencyCode: link.currencyCode,
      paymentMethod: link.paymentMethod,
      status: effectiveStatus,
      provider: link.provider,
      providerStatus: link.providerStatus,
      providerStatusLabel: link.providerStatusLabel,
      providerTransactionId: link.providerTransactionId,
      providerPayerPhone: link.providerPayerPhone,
      checkoutUrl: link.providerCheckoutUrl || link.providerLaunchUrl,
      title: link.title,
      description: link.description,
      instructions: link.instructions,
      paidAt: link.paidAt,
      expiresAt: link.expiresAt,
      country: link.country,
    });
  } catch (error) {
    console.error("externalPaymentLinks.getPublicLink error:", error);
    return res.status(500).json({ message: "Erreur serveur (getPublicLink)" });
  }
}

async function initiateWave(req, res) {
  try {
    const { token } = req.params;
    const { payerPhone } = req.body || {};
    const result = await externalWavePaymentService.initiateExternalWavePayment({
      req,
      token,
      payerPhone,
    });
    return res.json(result);
  } catch (error) {
    console.error("externalPaymentLinks.initiateWave error:", error);
    const message =
      error?.details?.code === "request-validation-error"
        ? "Paiement Wave indisponible pour ce lien. Merci de contacter l'équipe Forever."
        : error.message || "Erreur serveur (initiateWave)";
    return res.status(error.statusCode || 500).json({
      message,
    });
  }
}

async function syncWave(req, res) {
  try {
    const { token } = req.params;
    const result = await externalWavePaymentService.syncExternalWavePaymentStatus({
      req,
      token,
    });
    return res.json(result);
  } catch (error) {
    console.error("externalPaymentLinks.syncWave error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Erreur serveur (syncWave)",
    });
  }
}

module.exports = {
  createQrLink,
  getPublicLink,
  initiateWave,
  syncWave,
};
