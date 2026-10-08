const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const prisma = require("../prisma");
const { normalizeEmail, sendEmail } = require("../services/email.service");
const {
  buildNotificationSummaryForCustomer,
} = require("./customerNotifications.controller");

const GENERIC_OTP_REQUEST_MESSAGE =
  "Si ce compte existe et dispose d’une adresse email, un code de vérification lui sera envoyé par email.";
const GENERIC_OTP_VERIFY_MESSAGE = "Code OTP invalide ou expiré.";
const OTP_RESEND_UNAVAILABLE_MESSAGE =
  "Aucune adresse email valide n’est disponible pour ce compte. Contactez votre point de vente pour mettre à jour votre adresse email.";
const CIV_ZONE_COUNTRY_CODES = ["CIV", "BEN", "TGO", "NER", "BFA"];
const ACTIVE_ORDER_STATUSES = ["SUBMITTED", "INVOICED", "PAYMENT_PENDING", "PAID", "READY"];

function canonicalFboNumber(raw = "") {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 12) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9, 12)}`;
  }
  return String(raw || "").trim();
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

function otpResendCooldownSeconds() {
  const value = Number.parseInt(process.env.CUSTOMER_OTP_RESEND_COOLDOWN_SEC || "60", 10);
  if (!Number.isFinite(value) || value < 0 || value > 600) return 60;
  return value;
}

// Durée plancher de réponse pour /auth/otp/request : sans ça, un compte
// inexistant répond quasi instantanément (aucun envoi email) alors
// qu'un compte existant attend le retour de l'API email — un écart de
// latence mesurable qui permet de deviner quels numéros FBO existent même
// si le message renvoyé est identique dans les deux cas.
function otpRequestMinResponseMs() {
  const value = Number.parseInt(process.env.CUSTOMER_OTP_MIN_RESPONSE_MS || "1500", 10);
  if (!Number.isFinite(value) || value < 0) return 1500;
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProduction() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

function shouldIncludeDebugOtp() {
  return String(process.env.CUSTOMER_OTP_INCLUDE_DEBUG_CODE || "").toLowerCase() === "true";
}

function getOtpPepper() {
  const pepper = String(process.env.CUSTOMER_OTP_PEPPER || "").trim();
  if (pepper) return pepper;
  // Fallback: dériver un pepper stable depuis JWT_SECRET pour éviter de bloquer en prod
  // tant que CUSTOMER_OTP_PEPPER n'est pas encore configuré sur le serveur.
  const jwtSecret = String(process.env.JWT_SECRET || "").trim();
  if (jwtSecret) {
    return crypto.createHash("sha256").update(`otp-pepper:${jwtSecret}`).digest("hex");
  }
  if (isProduction()) {
    const err = new Error("CUSTOMER_OTP_PEPPER_MISSING");
    err.statusCode = 500;
    throw err;
  }
  return "appfbo_customer_otp_dev_only";
}

function otpHash(code) {
  const pepper = getOtpPepper();
  return crypto.createHash("sha256").update(`${pepper}:${String(code || "")}`).digest("hex");
}

function hashesEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "hex");
  const rightBuffer = Buffer.from(String(right || ""), "hex");
  if (leftBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function buildGenericOtpRequestResponse({ destinationMasked = "" } = {}) {
  return {
    ok: true,
    channel: "EMAIL",
    destinationMasked: destinationMasked || "destination masquée",
    expiresInMinutes: otpExpiresInMinutes(),
    retryAfterSeconds: otpResendCooldownSeconds(),
    message: GENERIC_OTP_REQUEST_MESSAGE,
  };
}

function buildOtpChannelMeta({ email = "" } = {}) {
  return { availableChannels: email ? ["EMAIL"] : [], destinations: email ? { EMAIL: maskEmail(email) } : {} };
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

async function resolveFboAndDestinations({ countryId, numeroFbo }) {
  const canonical = canonicalFboNumber(numeroFbo);
  if (!canonical) return null;
  const fbo = await prisma.fbo.findUnique({ where: { numeroFbo: canonical }, select: { id: true, numeroFbo: true, nomComplet: true, email: true } });
  if (!fbo) return null;
  let email = normalizeEmail(fbo.email || "");
  if (!email) {
    const orders = await prisma.preorder.findMany({
      where: { countryId, fboId: fbo.id, fboEmail: { not: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { fboEmail: true },
    });
    email = orders.map((order) => normalizeEmail(order.fboEmail || "")).find(Boolean) || "";
  }
  return { fbo, channel: "EMAIL", email, hasNoReachableChannel: !email };
}

async function requestOtp(req, res) {
  const startedAt = Date.now();
  // Répond toujours après un délai plancher identique, que le compte existe
  // ou non. Sans ça, un numéro FBO inconnu renvoie quasi instantanément
  // (aucun appel réseau) alors qu'un numéro valide attend le retour de
  // l'API email — un écart de latence mesurable qui révèle quels
  // numéros existent même si le corps de la réponse est identique.
  async function respond(status, payload) {
    const remaining = otpRequestMinResponseMs() - (Date.now() - startedAt);
    if (remaining > 0) await sleep(remaining);
    return res.status(status).json(payload);
  }

  try {
    const countryId = req.country?.id || req.countryId;
    const { numeroFbo } = req.body || {};
    if (!countryId) {
      return respond(400, { message: "Country required" });
    }
    if (!numeroFbo || !String(numeroFbo).trim()) {
      return respond(400, { message: "numeroFbo requis" });
    }

    const resolved = await resolveFboAndDestinations({
      countryId,
      numeroFbo,
    });

    if (!resolved) {
      return respond(200, buildGenericOtpRequestResponse({
        channel: "EMAIL",
      }));
    }

    const channelMeta = buildOtpChannelMeta({
      email: resolved.email,
    });

    if (resolved.hasNoReachableChannel) {
      return respond(409, {
        ok: false,
        message: OTP_RESEND_UNAVAILABLE_MESSAGE,
        channel: "",
        availableChannels: [],
        destinations: {},
        expiresInMinutes: otpExpiresInMinutes(),
      });
    }

    const now = new Date();
    const activeChallenge = await prisma.customerOtpChallenge.findFirst({
      where: {
        countryId,
        fboId: resolved.fbo.id,
        purpose: "CUSTOMER_PORTAL_LOGIN",
        channel: "EMAIL",
        consumedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });

    const cooldownSeconds = otpResendCooldownSeconds();
    if (activeChallenge && cooldownSeconds > 0) {
      const elapsedMs = now.getTime() - new Date(activeChallenge.createdAt).getTime();
      const retryAfterSeconds = Math.max(
        0,
        cooldownSeconds - Math.ceil(elapsedMs / 1000),
      );
      if (retryAfterSeconds > 0) {
        return respond(429, {
          ok: false,
          message: `Un code a déjà été envoyé récemment. Attendez ${retryAfterSeconds}s avant de redemander un nouveau code.`,
          channel: activeChallenge.channel || resolved.channel || "",
          destinationMasked: activeChallenge.destinationMasked || "",
          availableChannels: channelMeta.availableChannels,
          destinations: channelMeta.destinations,
          retryAfterSeconds,
          expiresInMinutes: otpExpiresInMinutes(),
        });
      }
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const expiresMin = otpExpiresInMinutes();
    const expiresAt = new Date(now.getTime() + expiresMin * 60 * 1000);
    const emailResult = await sendEmail({
      to: resolved.email, subject: "FOREVER | Code de connexion",
      body: `Votre code de connexion est ${otp}. Il expire dans ${expiresMin} minutes.`,
      metadata: { purpose: "CUSTOMER_PORTAL_LOGIN", fboId: resolved.fbo.id },
    });
    const successes = emailResult?.accepted ? [{ channel: "EMAIL", result: emailResult }] : [];
    const failures = emailResult?.accepted ? [] : [{ channel: "EMAIL", errorCode: emailResult?.errorCode || "EMAIL_SEND_FAILED", errorMessage: emailResult?.errorMessage || "Échec envoi email" }];
    const usedChannel = successes.length ? "EMAIL" : "";
    const destinationMasked = channelMeta.destinations.EMAIL;

    if (!successes.length || !usedChannel) {
      return respond(502, {
        message: "Impossible d'envoyer le code OTP",
        errorCode: failures?.[0]?.errorCode || "OTP_SEND_FAILED",
        failures,
      });
    }

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
            sentChannels: successes.map((entry) => entry.channel),
          },
        },
      });
    });

    return respond(200, {
      ...buildGenericOtpRequestResponse({
        channel: usedChannel,
        destinationMasked,
      }),
      availableChannels: channelMeta.availableChannels,
      destinations: channelMeta.destinations,
      sentChannels: successes.map((entry) => entry.channel),
      expiresInMinutes: expiresMin,
      ...(shouldIncludeDebugOtp() ? { debugOtp: otp } : {}),
    });
  } catch (e) {
    console.error("requestOtp error:", e);
    return respond(500, { message: "Erreur serveur (requestOtp)" });
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
      return res.status(400).json({ message: GENERIC_OTP_VERIFY_MESSAGE });
    }

    const now = new Date();
    const challenge = await prisma.customerOtpChallenge.findFirst({
      where: {
        countryId,
        fboId: fbo.id,
        purpose: "CUSTOMER_PORTAL_LOGIN",
        channel: "EMAIL",
        consumedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!challenge) {
      return res.status(400).json({ message: GENERIC_OTP_VERIFY_MESSAGE });
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      return res.status(429).json({ message: "Trop de tentatives OTP" });
    }

    if (!hashesEqual(challenge.codeHash, otpHash(code))) {
      await prisma.customerOtpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: challenge.maxAttempts } },
        data: { attempts: { increment: 1 } },
      });
      return res.status(400).json({ message: GENERIC_OTP_VERIFY_MESSAGE });
    }

    const consumed = await prisma.customerOtpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: challenge.maxAttempts } },
      data: {
        consumedAt: now,
        attempts: { increment: 1 },
      },
    });
    if (!consumed.count) return res.status(400).json({ message: GENERIC_OTP_VERIFY_MESSAGE });

    const token = signCustomerToken({
      fboId: fbo.id,
      countryId,
      numeroFbo: fbo.numeroFbo,
      email: fbo.email || null,
    });

    const cookieHours = Number.parseInt(process.env.CUSTOMER_JWT_EXPIRES_H || "12", 10);
    const cookieMaxAge = (Number.isFinite(cookieHours) && cookieHours > 0 ? cookieHours : 12) * 60 * 60 * 1000;
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";

    const nativeSession = req.body?.sessionTransport === "bearer";
    if (!nativeSession) res.cookie("cpt", token, {
      httpOnly: true,
      secure: isProd,
      // Le frontend (Vercel) et le backend (Render) sont deux domaines
      // différents : un cookie SameSite=Strict/Lax n'est jamais renvoyé sur
      // ces requêtes cross-site, ce qui déconnectait l'utilisateur aussitôt
      // après une connexion réussie. "None" exige "secure" (déjà vrai en prod).
      sameSite: isProd ? "none" : "lax",
      maxAge: cookieMaxAge,
      path: "/api/customer",
    });

    return res.json({
      ok: true,
      ...(nativeSession ? { token } : {}),
      // Le web conserve le cookie HttpOnly. L'application native demande
      // explicitement un jeton Bearer après la même vérification OTP.
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

function logout(req, res) {
  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  res.clearCookie("cpt", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/api/customer",
  });
  return res.json({ ok: true });
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

async function dashboard(req, res) {
  try {
    const customer = req.customer;
    const numeroFbo = canonicalFboNumber(customer?.numeroFbo || "");
    const fbo = await prisma.fbo.findUnique({
      where: { id: customer.fboId },
      select: {
        id: true,
        numeroFbo: true,
        nomComplet: true,
        email: true,
        grade: true,
        pointDeVente: true,
      },
    });

    if (!fbo) {
      return res.status(404).json({ message: "Client introuvable" });
    }

    const where = {
      country: { code: { in: CIV_ZONE_COUNTRY_CODES } },
      // Les brouillons (DRAFT) sont des paniers de "recommander" pas encore
      // finalisés : ce ne sont pas de vraies commandes, elles ne doivent pas
      // apparaître dans l'espace client.
      status: { not: "DRAFT" },
      OR: [
        { fboId: fbo.id },
        ...(numeroFbo ? [{ placedByFboNumero: numeroFbo }] : []),
      ],
    };

    const [
      totalOrders,
      activeOrders,
      selfOrders,
      placedForOthers,
      waitingPayment,
      readyOrders,
      latestOrders,
      countryRows,
      notificationSummary,
    ] = await Promise.all([
      prisma.preorder.count({ where }),
      prisma.preorder.count({
        where: { ...where, status: { in: ACTIVE_ORDER_STATUSES } },
      }),
      prisma.preorder.count({
        where: { country: where.country, status: { not: "DRAFT" }, fboId: fbo.id },
      }),
      numeroFbo
        ? prisma.preorder.count({
            where: { country: where.country, status: { not: "DRAFT" }, placedByFboNumero: numeroFbo },
          })
        : 0,
      prisma.preorder.count({
        where: {
          ...where,
          status: { in: ["INVOICED", "PAYMENT_PENDING"] },
          paymentStatus: { not: "PAID" },
        },
      }),
      prisma.preorder.count({
        where: { ...where, status: "READY" },
      }),
      prisma.preorder.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: 4,
        select: {
          id: true,
          preorderNumber: true,
          status: true,
          paymentStatus: true,
          totalFcfa: true,
          fboNumero: true,
          fboNomComplet: true,
          updatedAt: true,
          country: {
            select: {
              code: true,
              name: true,
            },
          },
        },
      }),
      prisma.preorder.groupBy({
        by: ["countryId"],
        where,
        _count: { _all: true },
      }),
      buildNotificationSummaryForCustomer({
        fboId: fbo.id,
        numeroFbo,
      }),
    ]);

    const countries = countryRows.length
      ? await prisma.country.findMany({
          where: { id: { in: countryRows.map((row) => row.countryId) } },
          select: { id: true, code: true, name: true },
        })
      : [];
    const countryById = new Map(countries.map((country) => [country.id, country]));

    return res.json({
      profile: {
        id: fbo.id,
        numeroFbo: fbo.numeroFbo,
        nomComplet: fbo.nomComplet,
        email: fbo.email || null,
        grade: fbo.grade,
        pointDeVente: fbo.pointDeVente,
        countryCode: req.country?.code || null,
      },
      stats: {
        totalOrders,
        activeOrders,
        selfOrders,
        placedForOthers,
        waitingPayment,
        readyOrders,
        notifications: notificationSummary.total,
        unreadNotifications: notificationSummary.unreadCount,
      },
      countries: countryRows.map((row) => {
        const country = countryById.get(row.countryId);
        return {
          code: country?.code || "",
          name: country?.name || "",
          ordersCount: row._count?._all || 0,
        };
      }),
      latestOrders: latestOrders.map((order) => ({
        ...order,
        relationType: order.fboNumero === numeroFbo ? "SELF" : "PLACED_FOR_OTHER",
      })),
    });
  } catch (e) {
    console.error("customer dashboard error:", e);
    return res.status(500).json({ message: "Erreur serveur (customer dashboard)" });
  }
}

module.exports = {
  requestOtp,
  verifyOtp,
  logout,
  me,
  dashboard,
};
