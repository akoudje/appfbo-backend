const prisma = require("../prisma");
const externalWavePaymentService = require("../services/external-wave-payment.service");

function isExpired(link) {
  return link?.expiresAt && new Date(link.expiresAt).getTime() < Date.now();
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
      checkoutUrl: link.providerCheckoutUrl || link.providerLaunchUrl,
      title: link.title,
      description: link.description,
      instructions: link.instructions,
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
  getPublicLink,
  initiateWave,
  syncWave,
};
