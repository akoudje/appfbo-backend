const prisma = require("../prisma");
const { pickCountryId } = require("../helpers/countryScope");
const { sendPreorderNotification } = require("../services/preorder-notifications.service");

const OPEN_STATUSES = new Set(["PENDING", "IN_REVIEW"]);
const ALLOWED_STATUS_UPDATES = new Set(["PENDING", "IN_REVIEW", "RESOLVED", "REJECTED"]);

function digitsOnly(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizeLocalPhone(value = "") {
  const digits = digitsOnly(value);
  if (digits.startsWith("225") && digits.length >= 13) return digits.slice(-10);
  return digits.slice(-10);
}

function normalizeFboNumber(value = "") {
  return digitsOnly(value);
}

function normalizePreorderNumber(value = "") {
  return String(value || "").trim().toUpperCase();
}

function maskPhone(value = "") {
  const digits = normalizeLocalPhone(value);
  if (digits.length < 6) return digits || "";
  return `${digits.slice(0, 2)}***${digits.slice(-3)}`;
}

function normalizeStatus(value = "") {
  const status = String(value || "").trim().toUpperCase();
  return ALLOWED_STATUS_UPDATES.has(status) ? status : "PENDING";
}

async function createPaymentLinkResendRequest(req, res) {
  try {
    const countryId = pickCountryId(req);
    const preorderNumber = normalizePreorderNumber(req.body?.preorderNumber);
    const fboNumero = normalizeFboNumber(req.body?.fboNumero);
    const originalPhone = normalizeLocalPhone(req.body?.originalPhone);
    const requestedWhatsappPhone = normalizeLocalPhone(req.body?.requestedWhatsappPhone);
    const note = String(req.body?.note || "").trim().slice(0, 500);

    if (!preorderNumber || !fboNumero || !originalPhone) {
      return res.status(400).json({
        message: "Numéro FBO, numéro de précommande et téléphone de commande requis.",
      });
    }

    const preorder = await prisma.preorder.findFirst({
      where: {
        countryId,
        preorderNumber,
      },
      select: {
        id: true,
        countryId: true,
        preorderNumber: true,
        fboNumero: true,
        factureWhatsappTo: true,
        fboNomComplet: true,
        fboEmail: true,
        factureReference: true,
        paymentCollectionCode: true,
        totalFcfa: true,
        preorderPaymentMode: true,
        paymentProvider: true,
        status: true,
        paymentStatus: true,
        activePayment: {
          select: {
            amountExpectedFcfa: true,
          },
        },
        messages: {
          where: {
            OR: [
              { paymentLinkTracked: { not: null } },
              { paymentLinkTarget: { not: null } },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            body: true,
            purpose: true,
            toPhone: true,
            paymentLinkTracked: true,
            paymentLinkTarget: true,
            createdAt: true,
          },
        },
      },
    });

    if (!preorder) {
      return res.status(404).json({ message: "Commande introuvable pour ce pays." });
    }

    if (String(preorder.paymentStatus || "").toUpperCase() === "PAID") {
      return res.status(409).json({
        message: "Cette commande est déjà marquée payée. Aucun renvoi de lien n'est nécessaire.",
      });
    }

    if (normalizeFboNumber(preorder.fboNumero) !== fboNumero) {
      return res.status(403).json({ message: "Les informations saisies ne correspondent pas." });
    }

    const orderPhone = normalizeLocalPhone(preorder.factureWhatsappTo);
    if (orderPhone && orderPhone !== originalPhone) {
      return res.status(403).json({ message: "Le téléphone saisi ne correspond pas à la commande." });
    }

    const latestPaymentLink =
      preorder.messages?.[0]?.paymentLinkTracked || preorder.messages?.[0]?.paymentLinkTarget || "";
    if (!latestPaymentLink) {
      return res.status(409).json({
        message:
          "Aucun lien de paiement n'est encore disponible pour cette commande. Contactez le service facturation.",
      });
    }

    const sameDestination =
      !requestedWhatsappPhone || requestedWhatsappPhone === originalPhone;
    const latestMessage = preorder.messages?.[0] || null;

    if (sameDestination) {
      const message =
        latestMessage?.body ||
        `FOREVER: Lien de paiement commande ${preorder.preorderNumber}: ${latestPaymentLink}`;
      const sendResult = await sendPreorderNotification({
        preorder: {
          ...preorder,
          factureWhatsappTo: originalPhone,
        },
        purpose: latestMessage?.purpose || "PAYMENT_LINK",
        message,
        actorName: "ASSISTANT_FBO",
        toPhone: originalPhone,
        toEmail: preorder.fboEmail || null,
        paymentLinkTarget: latestMessage?.paymentLinkTarget || latestPaymentLink,
        paymentLinkTracked: latestMessage?.paymentLinkTracked || latestPaymentLink,
      });

      const accepted = Boolean(sendResult?.sent || sendResult?.queued || sendResult?.smsQueued);

      await prisma.paymentLinkResendRequest.create({
        data: {
          countryId,
          preorderId: preorder.id,
          preorderNumber: preorder.preorderNumber,
          fboNumero,
          originalPhone,
          requestedWhatsappPhone: null,
          note: note || null,
          status: accepted ? "RESOLVED" : "PENDING",
          reviewNote: accepted
            ? `Renvoi automatique ${sendResult?.channel || "notification"} demandé depuis l'aide FBO.`
            : `Renvoi automatique échoué: ${sendResult?.errorMessage || sendResult?.reason || "canal indisponible"}`,
          reviewedAt: accepted ? new Date() : null,
        },
      });

      if (accepted) {
        return res.status(200).json({
          ok: true,
          autoSent: true,
          status: "RESOLVED",
          message:
            "Le lien de paiement a été renvoyé automatiquement par SMS et/ou email si disponible.",
          channel: sendResult?.channel || null,
          toPhone: sendResult?.toPhone || originalPhone,
          toEmail: sendResult?.toEmail || preorder.fboEmail || null,
        });
      }

      return res.status(202).json({
        ok: true,
        autoSent: false,
        status: "PENDING",
        message:
          "Le renvoi automatique n'a pas pu être confirmé. Votre demande a été transmise à l'équipe.",
      });
    }

    const existing = await prisma.paymentLinkResendRequest.findFirst({
      where: {
        countryId,
        preorderId: preorder.id,
        status: { in: Array.from(OPEN_STATUSES) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const request = existing
      ? await prisma.paymentLinkResendRequest.update({
          where: { id: existing.id },
          data: {
            originalPhone,
            requestedWhatsappPhone: requestedWhatsappPhone || null,
            note: note || null,
            status: "PENDING",
          },
        })
      : await prisma.paymentLinkResendRequest.create({
          data: {
            countryId,
            preorderId: preorder.id,
            preorderNumber: preorder.preorderNumber,
            fboNumero,
            originalPhone,
            requestedWhatsappPhone: requestedWhatsappPhone || null,
            note: note || null,
          },
        });

    return res.status(existing ? 200 : 201).json({
      ok: true,
      requestId: request.id,
      status: request.status,
      message:
        "Votre demande a été transmise. L'équipe vérifiera la commande avant de renvoyer le lien.",
      maskedOriginalPhone: maskPhone(originalPhone),
      maskedRequestedWhatsappPhone: requestedWhatsappPhone
        ? maskPhone(requestedWhatsappPhone)
        : null,
    });
  } catch (e) {
    console.error("createPaymentLinkResendRequest error:", e);
    return res.status(500).json({ message: "Erreur serveur." });
  }
}

async function listPaymentLinkResendRequests(req, res) {
  try {
    const countryId = pickCountryId(req);
    const status = String(req.query?.status || "PENDING").trim().toUpperCase();
    const where = { countryId };
    if (status && status !== "ALL") where.status = status;

    const items = await prisma.paymentLinkResendRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        preorder: {
          select: {
            id: true,
            preorderNumber: true,
            fboNomComplet: true,
            fboNumero: true,
            factureWhatsappTo: true,
            status: true,
            paymentStatus: true,
            totalFcfa: true,
          },
        },
      },
    });

    return res.json({ items });
  } catch (e) {
    console.error("listPaymentLinkResendRequests error:", e);
    return res.status(500).json({ message: "Erreur serveur." });
  }
}

async function updatePaymentLinkResendRequest(req, res) {
  try {
    const countryId = pickCountryId(req);
    const id = String(req.params?.id || "").trim();
    const status = normalizeStatus(req.body?.status);
    const reviewNote = String(req.body?.reviewNote || "").trim().slice(0, 500);

    const existing = await prisma.paymentLinkResendRequest.findFirst({
      where: { id, countryId },
      select: { id: true },
    });
    if (!existing) {
      return res.status(404).json({ message: "Demande introuvable." });
    }

    const updated = await prisma.paymentLinkResendRequest.update({
      where: { id: existing.id },
      data: {
        status,
        reviewNote: reviewNote || null,
        reviewedAt: ["RESOLVED", "REJECTED"].includes(status) ? new Date() : null,
        reviewedByAdminId: req.user?.id || null,
      },
    });

    return res.json(updated);
  } catch (e) {
    console.error("updatePaymentLinkResendRequest error:", e);
    return res.status(500).json({ message: "Erreur serveur." });
  }
}

module.exports = {
  createPaymentLinkResendRequest,
  listPaymentLinkResendRequests,
  updatePaymentLinkResendRequest,
};
