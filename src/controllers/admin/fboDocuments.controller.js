const crypto = require("crypto");
const prisma = require("../../prisma");

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeFboNumber(value) {
  return digitsOnly(value);
}

function fboNumberSearchTerms(value) {
  const raw = String(value || "").trim();
  const numeric = normalizeFboNumber(raw);
  const terms = new Set([raw]);
  if (numeric) {
    terms.add(numeric);
    const grouped = numeric.match(/.{1,3}/g)?.join("-");
    if (grouped) terms.add(grouped);
  }
  return [...terms].filter(Boolean);
}

function scopedFboWhere(req, extra = {}) {
  return {
    ...extra,
    OR: [
      { fboCountries: { some: { countryId: req.countryId } } },
      { fboCountries: { none: {} } },
    ],
  };
}

function documentNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/\D/g, "");
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `FBO-DOC-${stamp}-${suffix}`;
}

function verificationToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function serializeDocument(doc) {
  if (!doc) return null;
  return {
    ...doc,
    verifyUrl: `/verify/fbo-document/${encodeURIComponent(doc.verificationToken)}`,
  };
}

async function searchFbos(req, res) {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json({ data: [] });

    const numberTerms = fboNumberSearchTerms(q);
    const fbos = await prisma.fbo.findMany({
      where: scopedFboWhere(req, {
        AND: [{
          OR: [
          { nomComplet: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          ...numberTerms.flatMap((term) => ([
            { numeroFbo: { contains: term } },
            { numeroFbo: { endsWith: term } },
          ])),
          ],
        }],
      }),
      include: {
        fboCountries: {
          where: { countryId: req.countryId },
          include: { country: { select: { id: true, code: true, name: true } } },
          take: 1,
        },
        _count: { select: { documents: true } },
      },
      orderBy: [{ nomComplet: "asc" }],
      take: 20,
    });

    return res.json({ data: fbos });
  } catch (error) {
    console.error("fboDocuments.searchFbos error:", error);
    return res.status(500).json({ message: "Erreur serveur (searchFbos)" });
  }
}

async function listDocuments(req, res) {
  try {
    const { fboId, q, status } = req.query;
    const where = { countryId: req.countryId };
    if (fboId) where.fboId = String(fboId);
    if (status) where.status = String(status).trim().toUpperCase();
    if (q && String(q).trim()) {
      const term = String(q).trim();
      where.OR = [
        { documentNumber: { contains: term, mode: "insensitive" } },
        { fboNumber: { contains: normalizeFboNumber(term) || term } },
        { fboFullName: { contains: term, mode: "insensitive" } },
      ];
    }

    const docs = await prisma.fboDocument.findMany({
      where,
      orderBy: [{ issuedAt: "desc" }],
      take: 100,
      include: {
        issuedBy: { select: { id: true, fullName: true, email: true } },
        cancelledBy: { select: { id: true, fullName: true, email: true } },
      },
    });

    return res.json({ data: docs.map(serializeDocument) });
  } catch (error) {
    console.error("fboDocuments.listDocuments error:", error);
    return res.status(500).json({ message: "Erreur serveur (listDocuments)" });
  }
}

async function createDocument(req, res) {
  try {
    const {
      fboId,
      city = "Abidjan",
      purpose,
      signatoryName = "AHOU YAO EPSE KOFFI",
      signatoryTitle = "DIRECTRICE DES OPERATIONS",
    } = req.body || {};

    const fbo = await prisma.fbo.findFirst({
      where: scopedFboWhere(req, { id: String(fboId || "") }),
      include: {
        fboCountries: {
          where: { countryId: req.countryId },
          include: { country: { select: { id: true, code: true, name: true } } },
          take: 1,
        },
      },
    });
    if (!fbo) return res.status(404).json({ message: "FBO introuvable." });

    const countryLink = fbo.fboCountries?.[0] || null;
    const doc = await prisma.fboDocument.create({
      data: {
        countryId: req.countryId,
        fboId: fbo.id,
        documentNumber: documentNumber(),
        verificationToken: verificationToken(),
        fboNumber: fbo.numeroFbo,
        fboFullName: fbo.nomComplet,
        fboEmail: fbo.email || null,
        fboGrade: fbo.grade || null,
        fboPointDeVente: countryLink?.pointDeVente || fbo.pointDeVente || null,
        city: String(city || "Abidjan").trim(),
        purpose: purpose ? String(purpose).trim() : null,
        signatoryName: String(signatoryName || "").trim(),
        signatoryTitle: String(signatoryTitle || "").trim(),
        issuedById: req.user?.id || null,
        metadata: {
          countryCode: countryLink?.country?.code || null,
          countryName: countryLink?.country?.name || null,
        },
      },
      include: {
        issuedBy: { select: { id: true, fullName: true, email: true } },
      },
    });

    return res.status(201).json(serializeDocument(doc));
  } catch (error) {
    console.error("fboDocuments.createDocument error:", error);
    return res.status(500).json({ message: "Erreur serveur (createDocument)" });
  }
}

async function cancelDocument(req, res) {
  try {
    const document = await prisma.fboDocument.findFirst({
      where: { id: req.params.id, countryId: req.countryId },
    });
    if (!document) return res.status(404).json({ message: "Document introuvable." });
    if (document.status === "CANCELLED") return res.json(serializeDocument(document));

    const updated = await prisma.fboDocument.update({
      where: { id: document.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: req.body?.reason ? String(req.body.reason).trim() : null,
        cancelledById: req.user?.id || null,
      },
      include: {
        issuedBy: { select: { id: true, fullName: true, email: true } },
        cancelledBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    return res.json(serializeDocument(updated));
  } catch (error) {
    console.error("fboDocuments.cancelDocument error:", error);
    return res.status(500).json({ message: "Erreur serveur (cancelDocument)" });
  }
}

module.exports = {
  searchFbos,
  listDocuments,
  createDocument,
  cancelDocument,
};
