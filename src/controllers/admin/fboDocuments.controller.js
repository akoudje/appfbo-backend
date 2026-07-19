const crypto = require("crypto");
const prisma = require("../../prisma");

// Signataires habilités à apparaître sur une attestation FBO officielle.
// Le formulaire admin propose ces valeurs, mais c'est cette liste côté
// serveur qui fait foi: on ne fait jamais confiance à un nom/titre de
// signataire envoyé librement par le client.
const AUTHORIZED_SIGNATORIES = [
  { name: "AHOU YAO EPSE KOFFI", title: "DIRECTRICE DES OPERATIONS" },
];

function normalizeSignatoryKey(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function findAuthorizedSignatory(name, title) {
  const normalizedName = normalizeSignatoryKey(name);
  const normalizedTitle = normalizeSignatoryKey(title);
  return (
    AUTHORIZED_SIGNATORIES.find(
      (entry) =>
        normalizeSignatoryKey(entry.name) === normalizedName &&
        normalizeSignatoryKey(entry.title) === normalizedTitle,
    ) || null
  );
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeFboNumber(value) {
  return digitsOnly(value);
}

// Fbo.numeroFbo est stocké groupé par tirets (ex: "071-420-291-4XX"), mais
// un admin qui recherche par une partie du numéro (copiée depuis une commande,
// une capture d'écran, etc.) ne tape pas forcément les tirets aux bonnes
// positions. On compare donc sur le numéro réduit à ses seuls chiffres côté
// base de données, ce qui retrouve le FBO quel que soit le formatage saisi.
async function findFboIdsByDigits(digits) {
  if (!digits || digits.length < 3) return [];
  const rows = await prisma.$queryRaw`
    SELECT "id" FROM "Fbo"
    WHERE regexp_replace("numeroFbo", '\D', '', 'g') LIKE ${`%${digits}%`}
    LIMIT 50
  `;
  return rows.map((row) => row.id);
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

    const numberMatchIds = await findFboIdsByDigits(normalizeFboNumber(q));

    const fbos = await prisma.fbo.findMany({
      where: scopedFboWhere(req, {
        AND: [{
          OR: [
            { nomComplet: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            ...(numberMatchIds.length ? [{ id: { in: numberMatchIds } }] : []),
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

    // Un même FBO a parfois été enregistré plusieurs fois avec un numéro
    // saisi différemment (tirets/espaces) sur des commandes distinctes,
    // créant plusieurs fiches pour la même personne. On ne montre qu'une
    // fiche par numéro normalisé pour éviter les doublons visuels, en
    // gardant celle avec le plus d'historique de documents.
    const byDigits = new Map();
    for (const fbo of fbos) {
      const key = normalizeFboNumber(fbo.numeroFbo) || fbo.id;
      const existing = byDigits.get(key);
      if (!existing || (fbo._count?.documents || 0) > (existing._count?.documents || 0)) {
        byDigits.set(key, fbo);
      }
    }

    return res.json({ data: [...byDigits.values()] });
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
      signatoryName = AUTHORIZED_SIGNATORIES[0].name,
      signatoryTitle = AUTHORIZED_SIGNATORIES[0].title,
    } = req.body || {};

    const authorizedSignatory = findAuthorizedSignatory(signatoryName, signatoryTitle);
    if (!authorizedSignatory) {
      return res.status(400).json({
        message: "Signataire non autorisé pour ce type de document.",
      });
    }

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
        signatoryName: authorizedSignatory.name,
        signatoryTitle: authorizedSignatory.title,
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
