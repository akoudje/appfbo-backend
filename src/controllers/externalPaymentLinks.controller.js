const prisma = require("../prisma");

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
      amountFcfa: link.amountFcfa,
      currencyCode: link.currencyCode,
      paymentMethod: link.paymentMethod,
      status: effectiveStatus,
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

module.exports = {
  getPublicLink,
};
