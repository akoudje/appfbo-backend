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
// Le formulaire admin propose ces valeurs, mais c'est la base (table
// FboDocumentSignatory, gérée depuis l'admin) qui fait foi côté serveur :
// on ne fait jamais confiance à un nom/titre de signataire envoyé librement
// par le client. La civilité (M/MME) sert à accorder le texte de
// l'attestation ("Madame"/"Monsieur", "soussigné(e)"). Un signataire retiré
// ou modifié n'altère jamais les attestations déjà émises : FboDocument
// stocke une copie figée (signatoryName/Title/Civility), pas une référence.
function normalizeSignatoryKey(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

async function findAuthorizedSignatory(countryId, name, title) {
  const normalizedName = normalizeSignatoryKey(name);
  const normalizedTitle = normalizeSignatoryKey(title);
  if (!normalizedName || !normalizedTitle) return null;

  const candidates = await prisma.fboDocumentSignatory.findMany({
    where: { countryId, active: true },
  });
  return (
    candidates.find(
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

function serializeSignatory(row) {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    civility: row.civility,
    active: row.active,
    sortOrder: row.sortOrder,
  };
}

async function listSignatories(req, res) {
  try {
    const onlyActive = String(req.query?.all || "").trim() !== "1";
    const rows = await prisma.fboDocumentSignatory.findMany({
      where: { countryId: req.countryId, ...(onlyActive ? { active: true } : {}) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return res.json({ data: rows.map(serializeSignatory) });
  } catch (error) {
    console.error("fboDocuments.listSignatories error:", error);
    return res.status(500).json({ message: "Erreur serveur (listSignatories)" });
  }
}

async function createSignatory(req, res) {
  try {
    const name = String(req.body?.name || "").trim().toUpperCase();
    const title = String(req.body?.title || "").trim().toUpperCase();
    const civility = String(req.body?.civility || "").trim().toUpperCase();

    if (!name || !title) {
      return res.status(400).json({ message: "Nom et fonction du signataire requis." });
    }
    if (!["M", "MME"].includes(civility)) {
      return res.status(400).json({ message: "Civilité invalide (M ou MME)." });
    }

    const maxOrder = await prisma.fboDocumentSignatory.aggregate({
      where: { countryId: req.countryId },
      _max: { sortOrder: true },
    });

    const row = await prisma.fboDocumentSignatory.create({
      data: {
        countryId: req.countryId,
        name,
        title,
        civility,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
    });
    return res.status(201).json(serializeSignatory(row));
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ message: "Ce signataire (nom + fonction) existe déjà." });
    }
    console.error("fboDocuments.createSignatory error:", error);
    return res.status(500).json({ message: "Erreur serveur (createSignatory)" });
  }
}

async function updateSignatory(req, res) {
  try {
    const existing = await prisma.fboDocumentSignatory.findFirst({
      where: { id: req.params.id, countryId: req.countryId },
    });
    if (!existing) {
      return res.status(404).json({ message: "Signataire introuvable." });
    }

    const data = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name || "").trim().toUpperCase();
      if (!name) return res.status(400).json({ message: "Le nom ne peut pas être vide." });
      data.name = name;
    }
    if (req.body?.title !== undefined) {
      const title = String(req.body.title || "").trim().toUpperCase();
      if (!title) return res.status(400).json({ message: "La fonction ne peut pas être vide." });
      data.title = title;
    }
    if (req.body?.civility !== undefined) {
      const civility = String(req.body.civility || "").trim().toUpperCase();
      if (!["M", "MME"].includes(civility)) {
        return res.status(400).json({ message: "Civilité invalide (M ou MME)." });
      }
      data.civility = civility;
    }
    if (req.body?.active !== undefined) {
      data.active = Boolean(req.body.active);
    }

    const row = await prisma.fboDocumentSignatory.update({
      where: { id: existing.id },
      data,
    });
    return res.json(serializeSignatory(row));
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ message: "Ce signataire (nom + fonction) existe déjà." });
    }
    console.error("fboDocuments.updateSignatory error:", error);
    return res.status(500).json({ message: "Erreur serveur (updateSignatory)" });
  }
}

async function deleteSignatory(req, res) {
  try {
    const existing = await prisma.fboDocumentSignatory.findFirst({
      where: { id: req.params.id, countryId: req.countryId },
    });
    if (!existing) {
      return res.status(404).json({ message: "Signataire introuvable." });
    }

    const remaining = await prisma.fboDocumentSignatory.count({
      where: { countryId: req.countryId, active: true },
    });
    if (existing.active && remaining <= 1) {
      return res.status(400).json({
        message: "Impossible de retirer le dernier signataire actif : ajoutez-en un autre d'abord.",
      });
    }

    // Suppression réelle (pas de FK vers cette table depuis FboDocument, qui
    // n'en garde qu'une copie figée au moment de l'émission) : rien d'autre
    // ne référence cette ligne.
    await prisma.fboDocumentSignatory.delete({ where: { id: existing.id } });
    return res.json({ ok: true });
  } catch (error) {
    console.error("fboDocuments.deleteSignatory error:", error);
    return res.status(500).json({ message: "Erreur serveur (deleteSignatory)" });
  }
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
      signatoryName,
      signatoryTitle,
    } = req.body || {};

    const authorizedSignatory = await findAuthorizedSignatory(
      req.countryId,
      signatoryName,
      signatoryTitle,
    );
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
  createSignatory,
  updateSignatory,
  deleteSignatory,
  searchFbos,
  listDocuments,
  createDocument,
  cancelDocument,
};
