const prisma = require("../prisma");

const DEFAULT_MEMORIAL = {
  title: "Livre blanc d'hommage",
  personName: "Notre être cher",
  subtitle: "Un espace de recueillement pour partager vos messages, souvenirs et prières.",
  biography:
    "Cette page a été créée afin que la famille, les amis et les proches puissent laisser un témoignage et conserver une trace durable des souvenirs partagés.",
  thankYouMessage:
    "La famille vous remercie pour vos pensées, vos prières et vos témoignages.",
};

function normalizeSlug(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "livre-blanc";
}

function cleanText(value, maxLength) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.slice(0, maxLength);
}

function cleanLongText(value, maxLength) {
  const normalized = String(value || "").replace(/\r\n/g, "\n").trim();
  return normalized.slice(0, maxLength);
}

function optionalUrl(value) {
  const raw = cleanText(value, 1000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function serializeTribute(tribute, includePrivate = false) {
  return {
    id: tribute.id,
    authorName: tribute.authorName,
    relationship: tribute.relationship,
    message: tribute.message,
    photoUrl: tribute.photoUrl,
    candleLit: tribute.candleLit,
    status: includePrivate ? tribute.status : undefined,
    authorEmail: includePrivate ? tribute.authorEmail : undefined,
    authorPhone: includePrivate ? tribute.authorPhone : undefined,
    reviewedAt: includePrivate ? tribute.reviewedAt : undefined,
    createdAt: tribute.createdAt,
  };
}

function serializeMemorial(memorial, tributes = []) {
  return {
    id: memorial.id,
    slug: memorial.slug,
    title: memorial.title,
    personName: memorial.personName,
    subtitle: memorial.subtitle,
    birthDate: memorial.birthDate,
    deathDate: memorial.deathDate,
    coverImageUrl: memorial.coverImageUrl,
    biography: memorial.biography,
    thankYouMessage: memorial.thankYouMessage,
    publishedTributeCount: memorial._count?.tributes ?? tributes.length,
    tributes: tributes.map((tribute) => serializeTribute(tribute)),
  };
}

async function findOrCreateMemorial(countryId, slug) {
  const normalizedSlug = normalizeSlug(slug);
  const existing = await prisma.memorial.findUnique({
    where: { countryId_slug: { countryId, slug: normalizedSlug } },
  });
  if (existing) return existing;

  return prisma.memorial.create({
    data: {
      countryId,
      slug: normalizedSlug,
      ...DEFAULT_MEMORIAL,
    },
  });
}

async function getPublicMemorial(req, res) {
  try {
    const memorial = await findOrCreateMemorial(req.countryId, req.params.slug);
    if (!memorial.published) {
      return res.status(404).json({ message: "Livre d'hommage introuvable." });
    }

    const [freshMemorial, tributes] = await Promise.all([
      prisma.memorial.findUnique({
        where: { id: memorial.id },
        include: {
          _count: {
            select: { tributes: { where: { status: "PUBLISHED" } } },
          },
        },
      }),
      prisma.memorialTribute.findMany({
        where: { memorialId: memorial.id, status: "PUBLISHED" },
        orderBy: [{ createdAt: "desc" }],
        take: 200,
      }),
    ]);

    return res.json(serializeMemorial(freshMemorial, tributes));
  } catch (error) {
    console.error("getPublicMemorial error:", error);
    return res.status(500).json({ message: "Erreur serveur (getPublicMemorial)" });
  }
}

async function submitTribute(req, res) {
  try {
    const memorial = await findOrCreateMemorial(req.countryId, req.params.slug);
    if (!memorial.published) {
      return res.status(404).json({ message: "Livre d'hommage introuvable." });
    }

    const authorName = cleanText(req.body?.authorName, 120);
    const relationship = cleanText(req.body?.relationship, 120) || null;
    const authorEmail = cleanText(req.body?.authorEmail, 180) || null;
    const authorPhone = cleanText(req.body?.authorPhone, 40) || null;
    const message = cleanLongText(req.body?.message, 4000);
    const photoUrl = optionalUrl(req.body?.photoUrl);
    const candleLit = Boolean(req.body?.candleLit);

    if (!authorName) {
      return res.status(400).json({ message: "Votre nom est requis." });
    }
    if (message.length < 10) {
      return res.status(400).json({ message: "Le message doit contenir au moins 10 caractères." });
    }

    const tribute = await prisma.memorialTribute.create({
      data: {
        countryId: req.countryId,
        memorialId: memorial.id,
        authorName,
        relationship,
        authorEmail,
        authorPhone,
        message,
        photoUrl,
        candleLit,
        status: "PENDING",
      },
    });

    return res.status(201).json({
      ok: true,
      message: "Votre hommage a été reçu. Il sera publié après validation.",
      tribute: serializeTribute(tribute, true),
    });
  } catch (error) {
    console.error("submitTribute error:", error);
    return res.status(500).json({ message: "Erreur serveur (submitTribute)" });
  }
}

async function listAdminTributes(req, res) {
  try {
    const slug = normalizeSlug(req.query?.slug || "livre-blanc");
    const status = cleanText(req.query?.status || "PENDING", 20).toUpperCase();
    const allowedStatuses = new Set(["PENDING", "PUBLISHED", "ARCHIVED", "REJECTED", "ALL"]);

    const memorial = await findOrCreateMemorial(req.countryId, slug);
    const where = {
      countryId: req.countryId,
      memorialId: memorial.id,
      ...(allowedStatuses.has(status) && status !== "ALL" ? { status } : {}),
    };

    const tributes = await prisma.memorialTribute.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: 300,
    });

    return res.json({
      memorial: serializeMemorial(memorial, []),
      data: tributes.map((tribute) => serializeTribute(tribute, true)),
    });
  } catch (error) {
    console.error("listAdminTributes error:", error);
    return res.status(500).json({ message: "Erreur serveur (listAdminTributes)" });
  }
}

async function updateAdminTributeStatus(req, res) {
  try {
    const status = cleanText(req.body?.status, 20).toUpperCase();
    if (!["PENDING", "PUBLISHED", "ARCHIVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ message: "Statut invalide." });
    }

    const tribute = await prisma.memorialTribute.findFirst({
      where: { id: String(req.params.id || ""), countryId: req.countryId },
    });
    if (!tribute) return res.status(404).json({ message: "Hommage introuvable." });

    const updated = await prisma.memorialTribute.update({
      where: { id: tribute.id },
      data: {
        status,
        reviewedAt: new Date(),
        reviewedById: req.user?.id || null,
      },
    });

    return res.json(serializeTribute(updated, true));
  } catch (error) {
    console.error("updateAdminTributeStatus error:", error);
    return res.status(500).json({ message: "Erreur serveur (updateAdminTributeStatus)" });
  }
}

module.exports = {
  getPublicMemorial,
  submitTribute,
  listAdminTributes,
  updateAdminTributeStatus,
};
