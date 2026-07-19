const crypto = require("crypto");
const prisma = require("../../prisma");
const {
  digitsOnly,
  canonicalFboNumber,
  normalizeGrade,
  fetchFboDirectoryProfile,
} = require("../../services/fboDirectory.service");

// Grade par défaut pour une fiche FBO locale jamais vue auparavant, quand
// FBO Service renvoie un grade qu'on ne sait pas classer. Ne sert qu'à
// satisfaire la contrainte NOT NULL du modèle local Fbo ; l'attestation
// elle-même n'affiche pas ce champ.
const FALLBACK_GRADE = "CLIENT_PRIVILEGIE";

// Signataires habilités à apparaître sur une attestation FBO officielle.
// Le formulaire admin propose ces valeurs, mais c'est cette liste côté
// serveur qui fait foi: on ne fait jamais confiance à un nom/titre de
// signataire envoyé librement par le client. La civilité (M/MME) sert à
// accorder le texte de l'attestation ("Madame"/"Monsieur", "soussigné(e)").
const AUTHORIZED_SIGNATORIES = [
  { name: "AHOU YAO EPSE KOFFI", title: "DIRECTRICE DES OPERATIONS", civility: "MME" },
  { name: "KRA KOFFI", title: "DIRECTEUR FINANCIER", civility: "M" },
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

function normalizeFboNumber(value) {
  return digitsOnly(value);
}

// Le nom, la présence et le grade d'un FBO viennent exclusivement de FBO
// Service (registre officiel) : jamais du texte local saisi lors d'une
// commande. On maintient quand même une fiche Fbo locale minimale, car
// FboDocument a une clé étrangère obligatoire dessus ; elle est
// resynchronisée à chaque recherche pour rester le reflet de FBO Service.
async function syncLocalFboFromDirectory(digits, profile) {
  const canonical = canonicalFboNumber(digits);
  const fullName = String(profile?.full_name || "").trim();
  if (!canonical || !fullName) return null;

  const existing = await prisma.fbo.findUnique({ where: { numeroFbo: canonical } });
  const grade = normalizeGrade(profile?.grade) || existing?.grade || FALLBACK_GRADE;

  return prisma.fbo.upsert({
    where: { numeroFbo: canonical },
    update: {
      nomComplet: fullName,
      email: profile?.email || null,
      grade,
    },
    create: {
      numeroFbo: canonical,
      nomComplet: fullName,
      email: profile?.email || null,
      grade,
      pointDeVente: "",
    },
  });
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

// Point d'entrée unique "numéro -> fiche FBO à jour", utilisé par la
// recherche et par la création, pour ne jamais générer un document à
// partir d'une fiche locale potentiellement périmée.
async function resolveFboFromDirectory(rawNumero) {
  const digits = digitsOnly(rawNumero);
  if (digits.length !== 12) {
    return {
      ok: false,
      statusCode: 400,
      message: "Saisissez le numéro FBO complet (12 chiffres).",
    };
  }

  let profile;
  try {
    profile = await fetchFboDirectoryProfile(digits);
  } catch (error) {
    return {
      ok: false,
      statusCode: error?.statusCode || 502,
      message: error?.message || "Service FBO indisponible.",
    };
  }

  if (!profile || profile.exists === false) {
    return {
      ok: false,
      statusCode: 404,
      message: "Aucun FBO trouvé pour ce numéro dans FBO Service.",
    };
  }

  const fbo = await syncLocalFboFromDirectory(digits, profile);
  if (!fbo) {
    return {
      ok: false,
      statusCode: 502,
      message: "Réponse FBO Service incomplète pour ce numéro.",
    };
  }

  return { ok: true, fbo, profile };
}

async function listSignatories(req, res) {
  return res.json({ data: AUTHORIZED_SIGNATORIES });
}

async function searchFbos(req, res) {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ data: [] });

    const resolved = await resolveFboFromDirectory(q);
    if (!resolved.ok) {
      return res.status(resolved.statusCode).json({ data: [], message: resolved.message });
    }

    // Une attestation valide existe peut-être déjà pour ce FBO : on la
    // remonte pour éviter d'en régénérer une inutilement.
    const activeDocument = await prisma.fboDocument.findFirst({
      where: { fboId: resolved.fbo.id, countryId: req.countryId, status: "ISSUED" },
      orderBy: { issuedAt: "desc" },
    });

    return res.json({
      data: [
        {
          ...resolved.fbo,
          activeDocument: serializeDocument(activeDocument),
        },
      ],
    });
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
      numeroFbo,
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

    // On revérifie toujours auprès de FBO Service au moment de la
    // génération, plutôt que de faire confiance à un résultat de recherche
    // potentiellement obtenu plusieurs minutes plus tôt.
    const resolved = await resolveFboFromDirectory(numeroFbo);
    if (!resolved.ok) {
      return res.status(resolved.statusCode).json({ message: resolved.message });
    }
    const fbo = resolved.fbo;

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
        fboPointDeVente: null,
        city: String(city || "Abidjan").trim(),
        purpose: purpose ? String(purpose).trim() : null,
        signatoryName: authorizedSignatory.name,
        signatoryTitle: authorizedSignatory.title,
        signatoryCivility: authorizedSignatory.civility,
        issuedById: req.user?.id || null,
        metadata: {
          countryCode: req.country?.code || null,
          countryName: req.country?.name || null,
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
  listSignatories,
  searchFbos,
  listDocuments,
  createDocument,
  cancelDocument,
};
