const prisma = require("../../prisma");
const { scopeWhere } = require("../../helpers/countryScope");

const ALLOWED = {
  DRAFT: ["CANCELLED"],
  SUBMITTED: ["INVOICED", "CANCELLED"],
  INVOICED: ["PAYMENT_PENDING", "PAID", "CANCELLED"],
  PAYMENT_PENDING: ["PAID", "CANCELLED"],
  PAID: ["READY", "CANCELLED"],
  READY: ["FULFILLED", "CANCELLED"],
  FULFILLED: [],
  CANCELLED: [],
};

function assertTransition(from, to) {
  const ok = (ALLOWED[from] || []).includes(to);
  if (!ok) {
    const err = new Error(`Transition invalide ${from} -> ${to}`);
    err.statusCode = 400;
    throw err;
  }
}

async function addLogTx(tx, preorderId, action, note, meta, actorAdminId = null) {
  await tx.preorderLog.create({
    data: {
      preorderId,
      action,
      note: note || null,
      meta: meta || undefined,
      actorAdminId: actorAdminId || null,
    },
  });
}

function buildReceiptNumber({ preorder, reference, now = new Date() }) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const base = String(
    reference || preorder?.factureReference || preorder?.preorderNumber || preorder?.id || "REC",
  )
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(-8)
    .toUpperCase();

  return `RC-${y}${m}${d}-${base}`;
}

function extractPayerPhone(order) {
  const latestAttempt = order?.activePayment?.attempts?.[0];
  return (
    latestAttempt?.providerPayerPhone ||
    latestAttempt?.requestPayloadJson?.restrictPayerMobile ||
    latestAttempt?.normalizedPayloadJson?.providerPayerPhone ||
    null
  );
}

async function upsertCashierTransaction(tx, order, data) {
  const existing = await tx.cashierTransaction.findFirst({
    where: { preorderId: order.id },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    return tx.cashierTransaction.update({
      where: { id: existing.id },
      data,
    });
  }

  return tx.cashierTransaction.create({
    data: {
      preorderId: order.id,
      ...data,
    },
  });
}

async function markManualPaymentPending(req, res) {
  try {
    const { id } = req.params;
    const { manualPaymentProofUrl, manualPaymentReference, note } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      include: {
        activePayment: {
          include: {
            attempts: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (["PAYMENT_PENDING", "PAID", "READY", "FULFILLED"].includes(order.status)) {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        order,
      });
    }

    assertTransition(order.status, "PAYMENT_PENDING");

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "PAYMENT_PENDING",
          paymentStatus: "PAYMENT_PENDING",
          paymentProvider: "MANUAL",
          manualPaymentProofUrl: manualPaymentProofUrl
            ? String(manualPaymentProofUrl).trim()
            : order.manualPaymentProofUrl,
          manualPaymentReference: manualPaymentReference
            ? String(manualPaymentReference).trim()
            : order.manualPaymentReference,
          manualPaymentProofNote: note
            ? String(note).trim()
            : order.manualPaymentProofNote,
          manualPaymentReceivedAt: order.manualPaymentReceivedAt || now,
          billingWorkStatus: "WAITING_PAYMENT",
          billingLastActivityAt: now,
        },
      });

      await addLogTx(
        tx,
        id,
        "RECEIVE_MANUAL_PAYMENT_PROOF",
        note || "Preuve manuelle enregistrée",
        {
          fromStatus: order.status,
          toStatus: "PAYMENT_PENDING",
          manualPaymentReference: saved.manualPaymentReference,
        },
        req.user?.id || null,
      );

      await upsertCashierTransaction(tx, order, {
        cashierId: req.user?.id || null,
        paymentMode: String(order.preorderPaymentMode || "MANUAL"),
        amountExpectedFcfa: Number(order.activePayment?.amountExpectedFcfa || order.totalFcfa || 0),
        providerReference: saved.manualPaymentReference || null,
        payerPhone: extractPayerPhone(order),
      });

      return saved;
    });

    return res.json(updated);
  } catch (e) {
    console.error("markManualPaymentPending error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (markManualPaymentPending)" });
  }
}

async function validateManualPayment(req, res) {
  try {
    const { id } = req.params;
    const { note } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      include: {
        activePayment: {
          include: {
            attempts: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (["PAID", "READY", "FULFILLED"].includes(order.status)) {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        order,
      });
    }

    assertTransition(order.status, "PAID");

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paymentStatus: "PAID",
          paymentProvider: order.paymentProvider || "MANUAL",
          manualPaymentValidatedAt: order.manualPaymentValidatedAt || now,
          manualPaymentValidatedById:
            order.manualPaymentValidatedById || req.user?.id || null,
          paidAt: order.paidAt || now,
          billingWorkStatus: "COMPLETED",
          billingCompletedAt: order.billingCompletedAt || now,
          billingLastActivityAt: now,
          internalNote: note ? String(note).trim() : order.internalNote,
        },
      });

      await addLogTx(
        tx,
        id,
        "VALIDATE_MANUAL_PAYMENT",
        note || "Paiement manuel validé",
        {
          fromStatus: order.status,
          toStatus: "PAID",
        },
        req.user?.id || null,
      );

      await addLogTx(
        tx,
        id,
        "PAYMENT_CONFIRMED",
        "Paiement confirmé",
        {
          paymentProvider: saved.paymentProvider,
          paymentStatus: saved.paymentStatus,
        },
        req.user?.id || null,
      );

      await upsertCashierTransaction(tx, order, {
        cashierId: req.user?.id || null,
        paymentMode: String(order.preorderPaymentMode || order.paymentProvider || "MANUAL"),
        amountExpectedFcfa: Number(order.activePayment?.amountExpectedFcfa || order.totalFcfa || 0),
        providerReference: order.manualPaymentReference || null,
        payerPhone: extractPayerPhone(order),
      });

      return saved;
    });

    return res.json(updated);
  } catch (e) {
    console.error("validateManualPayment error:", e);
    return res
      .status(e.statusCode || 500)
      .json({ message: e.message || "Erreur serveur (validateManualPayment)" });
  }
}

async function markCashPayment(req, res) {
  try {
    const { id } = req.params;
    const { note, reference, amountReceivedFcfa, receiptNumber, cashDeskLabel } =
      req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
      include: {
        activePayment: {
          include: {
            attempts: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (["PAID", "READY", "FULFILLED"].includes(order.status)) {
      return res.json({
        ok: true,
        alreadyDone: true,
        status: order.status,
        order,
      });
    }

    const allowedFrom = ["SUBMITTED", "INVOICED", "PAYMENT_PENDING"];
    if (!allowedFrom.includes(order.status)) {
      return res.status(400).json({
        message: `Transition invalide ${order.status} -> PAID (manuel/cash)`,
      });
    }

    const normalizedReceiptNumber = String(receiptNumber || "").trim();
    if (!normalizedReceiptNumber) {
      return res.status(400).json({
        message: "Le numéro de reçu caisse est obligatoire pour un encaissement espèces.",
      });
    }

    const normalizedCashDeskLabel = String(cashDeskLabel || "").trim() || null;
    const receivedAmount = Number(amountReceivedFcfa || 0);
    if (!Number.isFinite(receivedAmount) || receivedAmount <= 0) {
      return res.status(400).json({
        message: "Le montant reçu en caisse est obligatoire.",
      });
    }

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.preorder.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paymentStatus: "PAID",
          paymentProvider: "MANUAL",
          manualPaymentReference: reference
            ? String(reference).trim()
            : order.manualPaymentReference,
          manualPaymentValidatedAt: order.manualPaymentValidatedAt || now,
          manualPaymentValidatedById:
            order.manualPaymentValidatedById || req.user?.id || null,
          paidAt: order.paidAt || now,
          billingWorkStatus: "COMPLETED",
          billingCompletedAt: order.billingCompletedAt || now,
          billingLastActivityAt: now,
          internalNote: note ? String(note).trim() : order.internalNote,
        },
      });

      await addLogTx(
        tx,
        id,
        "VALIDATE_MANUAL_PAYMENT",
        note || "Paiement manuel encaissé",
        {
          fromStatus: order.status,
          toStatus: "PAID",
          paymentProvider: "MANUAL",
          manualPaymentReference: saved.manualPaymentReference,
          receiptNumber: normalizedReceiptNumber,
          cashDeskLabel: normalizedCashDeskLabel,
          amountReceivedFcfa: receivedAmount,
        },
        req.user?.id || null,
      );

      await addLogTx(
        tx,
        id,
        "PAYMENT_CONFIRMED",
        "Paiement confirmé",
        {
          paymentProvider: "MANUAL",
          paymentStatus: "PAID",
        },
        req.user?.id || null,
      );

      await upsertCashierTransaction(tx, order, {
        cashierId: req.user?.id || null,
        paymentMode: "ESPECES",
        amountExpectedFcfa: Number(order.activePayment?.amountExpectedFcfa || order.totalFcfa || 0),
        amountReceivedFcfa: Math.round(receivedAmount),
        providerReference:
          (reference ? String(reference).trim() : null) ||
          order.manualPaymentReference ||
          buildReceiptNumber({ preorder: order, reference: normalizedReceiptNumber, now }),
        payerPhone: extractPayerPhone(order),
        receiptNumber: normalizedReceiptNumber,
        cashDeskLabel: normalizedCashDeskLabel,
      });

      return saved;
    });

    return res.json(updated);
  } catch (e) {
    console.error("markCashPayment error:", e);
    return res.status(500).json({ message: "Erreur serveur (markCashPayment)" });
  }
}

module.exports = {
  markManualPaymentPending,
  validateManualPayment,
  markCashPayment,
  markPaymentProof: markManualPaymentPending,
  verifyPayment: validateManualPayment,
  payOrder: markCashPayment,
};
