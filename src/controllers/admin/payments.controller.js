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

async function markManualPaymentPending(req, res) {
  try {
    const { id } = req.params;
    const { manualPaymentProofUrl, manualPaymentReference, note } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
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
    const { note, reference } = req.body || {};

    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, { id }),
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
