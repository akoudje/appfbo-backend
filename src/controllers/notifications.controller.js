const prisma = require("../prisma");

function canonicalFboNumber(raw = "") {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 12) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9, 12)}`;
  }
  return String(raw || "").trim();
}

function normalizePlatform(raw = "") {
  const value = String(raw || "").trim().toLowerCase();
  return ["ios", "android", "web"].includes(value) ? value : "unknown";
}

function isValidExpoToken(raw = "") {
  const token = String(raw || "").trim();
  if (token.length < 20 || token.length > 512) return false;
  return /^(ExpoPushToken|ExponentPushToken)\[[^\]]+\]$/.test(token);
}

async function registerToken(req, res) {
  try {
    const countryId = req.country?.id || req.countryId || null;
    const token = String(req.body?.token || "").trim();
    const numeroFbo = canonicalFboNumber(req.body?.numeroFbo);
    const platform = normalizePlatform(req.body?.platform);

    if (!isValidExpoToken(token)) {
      return res.status(400).json({ message: "Token push Expo invalide." });
    }

    if (!numeroFbo) {
      return res.status(400).json({ message: "numeroFbo requis." });
    }

    const fbo = await prisma.fbo.findUnique({
      where: { numeroFbo },
      select: { id: true },
    });

    if (!fbo) {
      return res.status(404).json({ message: "FBO introuvable." });
    }

    const row = await prisma.mobilePushToken.upsert({
      where: { token },
      create: {
        token,
        platform,
        fboId: fbo.id,
        countryId,
        enabled: true,
        lastSeenAt: new Date(),
      },
      update: {
        platform,
        fboId: fbo.id,
        countryId,
        enabled: true,
        lastSeenAt: new Date(),
      },
      select: {
        id: true,
        enabled: true,
        lastSeenAt: true,
      },
    });

    return res.json({ ok: true, tokenId: row.id, enabled: row.enabled, lastSeenAt: row.lastSeenAt });
  } catch (error) {
    console.error("register push token error:", error);
    return res.status(500).json({ message: "Impossible d'enregistrer le token push." });
  }
}

module.exports = {
  registerToken,
};
