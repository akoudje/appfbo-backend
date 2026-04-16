const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const prisma = require("../prisma");
const { normalizeEmail, sendEmail } = require("../services/email.service");
const { normalizePhone, sendSms } = require("../services/sms.service");

function canonicalFboNumber(raw = "") {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 12) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9, 12)}`;
  }
  return String(raw || "").trim();
}

function maskPhone(value = "") {
  const clean = String(value || "").replace(/\D/g, "");
  if (!clean) return "";
  if (clean.length <= 4) return `***${clean}`;
  return `${"*".repeat(Math.max(0, clean.length - 4))}${clean.slice(-4)}`;
}

function maskEmail(value = "") {
  const email = String(value || "").trim().toLowerCase();
  const [local, domain] = email.split("@");
  if (!local || !domain) return "";
  if (local.length <= 2) return `**@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

function otpExpiresInMinutes() {
  const value = Number.parseInt(process.env.CUSTOMER_OTP_EXPIRES_MIN || "10", 10);
  if (!Number.isFinite(value) || value < 1 || value > 60) return 10;
  return value;
}

function otpHash(code) {
  const pepper = process.env.CUSTOMER_OTP_PEPPER || "appfbo_customer_otp";
  return crypto.createHash("sha256").update(`${pepper}:${String(code || "")}`).digest("hex");
}

function signCustomerToken({ fboId, countryId, numeroFbo, email }) {
  const secret = process.env.CUSTOMER_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("CUSTOMER_JWT_SECRET_MISSING");
  }

  const hours = Number.parseInt(process.env.CUSTOMER_JWT_EXPIRES_H || "12", 10);
  const expiresIn = `${Number.isFinite(hours) && hours > 0 ? hours : 12}h`;

  return jwt.sign(
    {
      sub: fboId,
      type: "customer",
      countryId,
      numeroFbo,
      email: email || null,
    },
    secret,
    { expiresIn },
  );
}

async function resolveFboAndDestinations({ countryId, numeroFbo, requestedChannel, phoneInput }) {
  const canonical = canonicalFboNumber(numeroFbo);
  if (!canonical) return null;

  const fbo = await prisma.fbo.findUnique({
    where: { numeroFbo: canonical },
    select: {
      id: true,
      numeroFbo: true,
      nomComplet: true,
      email: true,
    },
  });
  if (!fbo) return null;

  const latestOrder = await prisma.preorder.findFirst({
    where: {
      countryId,
      fboId: fbo.id,
    },
    orderBy: { createdAt: "desc" },
    select: {
      factureWhatsappTo: true,
      fboEmail: true,
    },
  });

  const smsPhone = normalizePhone(phoneInput || latestOrder?.factureWhatsappTo || "");
  const email = normalizeEmail(fbo.email || latestOrder?.fboEmail || "");

  let channel = String(requestedChannel || "").trim().toUpperCase();
  if (!["SMS", "EMAIL"].includes(channel)) channel = "";
  if (!channel) channel = smsPhone ? "SMS" : "EMAIL";
  if (channel === "SMS" && !smsPhone && email) channel = "EMAIL";
  if (channel === "EMAIL" && !email && smsPhone) channel = "SMS";
  if (!smsPhone && !email) return null;

  return {
    fbo,
    channel,
    smsPhone,
    email,
  };
}

async function requestOtp(req, res) {
  try {
    const countryId = req.country?.id || req.countryId;
    const { numeroFbo, channel, phone } = req.body || {};
    if (!countryId) {
      return res.status(400).json({ message: "Country required" });
    }
    if (!numeroFbo || !String(numeroFbo).trim()) {
      return res.status(400).json({ message: "numeroFbo requis" });
    }

    const resolved = await resolveFboAndDestinations({
      countryId,
      numeroFbo,
      requestedChannel: channel,
      phoneInput: phone,
    });

    if (!resolved) {
      return res.status(404).json({ message: "Client introuvable ou canal OTP indisponible" });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiresMin = otpExpiresInMinutes();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresMin * 60 * 1000);
    const preferredFirst = resolved.channel === "SMS" ? ["SMS", "EMAIL"] : ["EMAIL", "SMS"];
    const channelsToTry = preferredFirst.filter((ch, idx, arr) => arr.indexOf(ch) === idx);
    const failures = [];
    let sent = null;
    let usedChannel = null;

    for (const ch of channelsToTry) {
      if (ch === "SMS" && resolved.smsPhone) {
        const smsResult = await sendSms({
          to: resolved.smsPhone,
          message: `Code connexion ${otp}. Expire dans ${expiresMin} min.`,
        });
        if (smsResult?.accepted) {
          sent = smsResult;
          usedChannel = "SMS";
          break;
        }
        failures.push({
          channel: "SMS",
          errorCode: smsResult?.errorCode || "SMS_SEND_FAILED",
          errorMessage: smsResult?.errorMessage || "Échec envoi SMS",
        });
      }

      if (ch === "EMAIL" && resolved.email) {
        const emailResult = await sendEmail({
          to: resolved.email,
          subject: "FOREVER | Code de connexion",
          body: `Votre code de connexion est ${otp}. Il expire dans ${expiresMin} minutes.`,
          metadata: {
            purpose: "CUSTOMER_PORTAL_LOGIN",
            fboId: resolved.fbo.id,
          },
        });
        if (emailResult?.accepted) {
          sent = emailResult;
          usedChannel = "EMAIL";
          break;
        }
        failures.push({
          channel: "EMAIL",
          errorCode: emailResult?.errorCode || "EMAIL_SEND_FAILED",
          errorMessage: emailResult?.errorMessage || "Échec envoi email",
        });
      }
    }

    if (!sent?.accepted || !usedChannel) {
      return res.status(502).json({
        message: "Impossible d'envoyer le code OTP",
        errorCode: failures?.[0]?.errorCode || "OTP_SEND_FAILED",
        failures,
      });
    }

    const destinationMasked = usedChannel === "SMS" ? maskPhone(resolved.smsPhone) : maskEmail(resolved.email);

    await prisma.$transaction(async (tx) => {
      await tx.customerOtpChallenge.updateMany({
        where: {
          countryId,
          fboId: resolved.fbo.id,
          purpose: "CUSTOMER_PORTAL_LOGIN",
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });

      await tx.customerOtpChallenge.create({
        data: {
          countryId,
          fboId: resolved.fbo.id,
          purpose: "CUSTOMER_PORTAL_LOGIN",
          channel: usedChannel,
          destinationMasked,
          codeHash: otpHash(otp),
          expiresAt,
          meta: {
            requestId: req.requestId || null,
            countryCode: req.country?.code || null,
            fallbackFrom: resolved.channel !== usedChannel ? resolved.channel : null,
          },
        },
      });
    });

    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.json({
      ok: true,
      channel: usedChannel,
      destinationMasked,
      expiresInMinutes: expiresMin,
      ...(isProd ? {} : { debugOtp: otp }),
    });
  } catch (e) {
    console.error("requestOtp error:", e);
    return res.status(500).json({ message: "Erreur serveur (requestOtp)" });
  }
}

async function verifyOtp(req, res) {
  try {
    const countryId = req.country?.id || req.countryId;
    const { numeroFbo, code } = req.body || {};
    if (!countryId) {
      return res.status(400).json({ message: "Country required" });
    }
    if (!numeroFbo || !String(numeroFbo).trim()) {
      return res.status(400).json({ message: "numeroFbo requis" });
    }
    if (!code || !String(code).trim()) {
      return res.status(400).json({ message: "Code OTP requis" });
    }

    const canonical = canonicalFboNumber(numeroFbo);
    const fbo = await prisma.fbo.findUnique({
      where: { numeroFbo: canonical },
      select: {
        id: true,
        numeroFbo: true,
        nomComplet: true,
        email: true,
      },
    });
    if (!fbo) {
      return res.status(404).json({ message: "Client introuvable" });
    }

    const now = new Date();
    const challenge = await prisma.customerOtpChallenge.findFirst({
      where: {
        countryId,
        fboId: fbo.id,
        purpose: "CUSTOMER_PORTAL_LOGIN",
        consumedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!challenge) {
      return res.status(400).json({ message: "Code expiré ou introuvable" });
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      return res.status(429).json({ message: "Trop de tentatives OTP" });
    }

    if (challenge.codeHash !== otpHash(code)) {
      await prisma.customerOtpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      return res.status(400).json({ message: "Code OTP invalide" });
    }

    await prisma.customerOtpChallenge.update({
      where: { id: challenge.id },
      data: {
        consumedAt: now,
        attempts: { increment: 1 },
      },
    });

    const token = signCustomerToken({
      fboId: fbo.id,
      countryId,
      numeroFbo: fbo.numeroFbo,
      email: fbo.email || null,
    });

    return res.json({
      ok: true,
      token,
      profile: {
        fboId: fbo.id,
        numeroFbo: fbo.numeroFbo,
        nomComplet: fbo.nomComplet,
        email: fbo.email || null,
        countryCode: req.country?.code || null,
      },
    });
  } catch (e) {
    console.error("verifyOtp error:", e);
    return res.status(500).json({ message: "Erreur serveur (verifyOtp)" });
  }
}

async function me(req, res) {
  try {
    const customer = req.customer;
    const fbo = await prisma.fbo.findUnique({
      where: { id: customer.fboId },
      select: {
        id: true,
        numeroFbo: true,
        nomComplet: true,
        email: true,
      },
    });
    if (!fbo) {
      return res.status(404).json({ message: "Client introuvable" });
    }

    return res.json({
      id: fbo.id,
      numeroFbo: fbo.numeroFbo,
      nomComplet: fbo.nomComplet,
      email: fbo.email || null,
      countryCode: req.country?.code || null,
    });
  } catch (e) {
    console.error("customer me error:", e);
    return res.status(500).json({ message: "Erreur serveur (customer me)" });
  }
}

module.exports = {
  requestOtp,
  verifyOtp,
  me,
};
