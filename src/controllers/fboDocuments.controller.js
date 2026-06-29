const prisma = require("../prisma");

async function verifyFboDocument(req, res) {
  try {
    const token = String(req.params.token || "").trim();
    if (!token) return res.status(400).json({ message: "Token de vérification requis." });

    const doc = await prisma.fboDocument.findUnique({
      where: { verificationToken: token },
      include: {
        country: { select: { code: true, name: true } },
        issuedBy: { select: { fullName: true } },
      },
    });

    if (!doc) return res.status(404).json({ valid: false, message: "Document introuvable." });

    return res.json({
      valid: doc.status === "ISSUED",
      status: doc.status,
      documentNumber: doc.documentNumber,
      type: doc.type,
      fboFullName: doc.fboFullName,
      fboNumber: doc.fboNumber,
      city: doc.city,
      issuedAt: doc.issuedAt,
      signatoryName: doc.signatoryName,
      signatoryTitle: doc.signatoryTitle,
      country: doc.country,
      cancelledAt: doc.cancelledAt,
    });
  } catch (error) {
    console.error("verifyFboDocument error:", error);
    return res.status(500).json({ message: "Erreur serveur (verifyFboDocument)" });
  }
}

module.exports = {
  verifyFboDocument,
};
