// src/services/billingQueue.service.js
// Service pour gérer la file de précommandes à facturer

const prisma = require("../prisma");

function isBillingActiveStatus(status) {
  return [
    "ASSIGNED",
    "IN_PROGRESS",
    "WAITING_CUSTOMER_DATA",
    "WAITING_PAYMENT",
  ].includes(status);
}

async function releaseExpiredAssignments({ countryId }) {
  const settings = await prisma.countrySettings.findUnique({
    where: { countryId },
    select: {
      billingClaimTimeoutMin: true,
    },
  });

  const timeoutMin = settings?.billingClaimTimeoutMin || 15;
  const cutoff = new Date(Date.now() - timeoutMin * 60 * 1000);
  const now = new Date();

  const expired = await prisma.preorder.findMany({
    where: {
      countryId,
      assignedInvoicerId: { not: null },
      billingWorkStatus: { in: ["ASSIGNED", "IN_PROGRESS"] },
      billingLastActivityAt: { lt: cutoff },
      status: { in: ["SUBMITTED", "INVOICED", "PAYMENT_PENDING"] },
    },
    select: {
      id: true,
      assignedInvoicerId: true,
    },
  });

  if (!expired.length) return { releasedCount: 0 };

  await prisma.$transaction(async (tx) => {
    for (const row of expired) {
      await tx.preorder.update({
        where: { id: row.id },
        data: {
          assignedInvoicerId: null,
          assignedAt: null,
          billingWorkStatus: "RELEASED",
          billingReleasedAt: now,
          billingLastActivityAt: now,
        },
      });

      await tx.preorderLog.create({
        data: {
          preorderId: row.id,
          action: "RELEASE_INVOICER",
          note: "Attribution expirée automatiquement, dossier remis dans la file",
          actorAdminId: null,
          meta: {
            previousAssignedInvoicerId: row.assignedInvoicerId,
            mode: "AUTO_TIMEOUT_RELEASE",
          },
        },
      });
    }
  });

  return { releasedCount: expired.length };
}

async function claimNextPreorderForInvoicer({ userId, countryId }) {
  if (!userId) {
    return {
      ok: false,
      reason: "UNAUTHENTICATED_USER",
    };
  }

  await releaseExpiredAssignments({ countryId });

  const settings = await prisma.countrySettings.findUnique({
    where: { countryId },
    select: {
      maxActiveBillingPerInvoicer: true,
    },
  });

  const maxActive = settings?.maxActiveBillingPerInvoicer || 5;

  const activeCount = await prisma.preorder.count({
    where: {
      countryId,
      assignedInvoicerId: userId,
      billingWorkStatus: {
        in: ["ASSIGNED", "IN_PROGRESS", "WAITING_CUSTOMER_DATA", "WAITING_PAYMENT"],
      },
    },
  });

  if (activeCount >= maxActive) {
    return {
      ok: false,
      reason: "MAX_ACTIVE_REACHED",
      activeCount,
      maxActive,
    };
  }

  return prisma.$transaction(async (tx) => {
    const candidate = await tx.preorder.findFirst({
      where: {
        countryId,
        status: "SUBMITTED",
        billingWorkStatus: { in: ["QUEUED", "RELEASED"] },
        assignedInvoicerId: null,
      },
      orderBy: [
        { billingPriority: "desc" },
        { billingQueueEnteredAt: "asc" },
        { createdAt: "asc" },
      ],
      select: {
        id: true,
      },
    });

    if (!candidate) {
      return {
        ok: false,
        reason: "NO_ORDER_AVAILABLE",
      };
    }

    const now = new Date();

    const updated = await tx.preorder.update({
      where: { id: candidate.id },
      data: {
        assignedInvoicerId: userId,
        assignedAt: now,
        billingWorkStatus: "ASSIGNED",
        billingLastActivityAt: now,
      },
      include: {
        assignedInvoicer: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    await tx.preorderLog.create({
      data: {
        preorderId: updated.id,
        action: "ASSIGN_INVOICER",
        note: "Précommande attribuée automatiquement à un facturier",
        actorAdminId: userId,
        meta: {
          assignedInvoicerId: userId,
          mode: "AUTO_CLAIM",
        },
      },
    });

    return {
      ok: true,
      preorder: updated,
    };
  });
}

async function startBillingWork({ preorderId, userId, countryId }) {
  const preorder = await prisma.preorder.findFirst({
    where: {
      id: preorderId,
      countryId,
      assignedInvoicerId: userId,
    },
  });

  if (!preorder) {
    throw new Error("PREORDER_NOT_FOUND_OR_NOT_ASSIGNED");
  }

  if (!["ASSIGNED", "IN_PROGRESS"].includes(preorder.billingWorkStatus)) {
    throw new Error("PREORDER_NOT_STARTABLE");
  }

  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.preorder.update({
      where: { id: preorder.id },
      data: {
        billingWorkStatus: "IN_PROGRESS",
        billingStartedAt: preorder.billingStartedAt || now,
        billingLastActivityAt: now,
      },
    });

    await tx.preorderLog.create({
      data: {
        preorderId: preorder.id,
        action: "START_BILLING",
        note: "Traitement de facturation démarré",
        actorAdminId: userId,
        meta: {
          billingWorkStatus: "IN_PROGRESS",
        },
      },
    });

    return saved;
  });

  return updated;
}

async function releaseBillingWork({ preorderId, userId, countryId, reason }) {
  const preorder = await prisma.preorder.findFirst({
    where: {
      id: preorderId,
      countryId,
    },
  });

  if (!preorder) throw new Error("PREORDER_NOT_FOUND");

  const allowed = preorder.assignedInvoicerId === userId || !userId;
  if (!allowed) throw new Error("NOT_ALLOWED_TO_RELEASE");

  if (
    !["ASSIGNED", "IN_PROGRESS", "WAITING_CUSTOMER_DATA", "WAITING_PAYMENT"].includes(
      preorder.billingWorkStatus,
    )
  ) {
    throw new Error("PREORDER_NOT_RELEASABLE");
  }

  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.preorder.update({
      where: { id: preorder.id },
      data: {
        assignedInvoicerId: null,
        assignedAt: null,
        billingWorkStatus: "RELEASED",
        billingReleasedAt: now,
        billingLastActivityAt: now,
      },
    });

    await tx.preorderLog.create({
      data: {
        preorderId: preorder.id,
        action: "RELEASE_INVOICER",
        note: reason || "Dossier remis dans la file",
        actorAdminId: userId || null,
        meta: {
          previousAssignedInvoicerId: preorder.assignedInvoicerId,
        },
      },
    });

    return saved;
  });

  return updated;
}

async function escalateBillingWork({ preorderId, userId, countryId, reason }) {
  const preorder = await prisma.preorder.findFirst({
    where: {
      id: preorderId,
      countryId,
    },
  });

  if (!preorder) throw new Error("PREORDER_NOT_FOUND");

  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.preorder.update({
      where: { id: preorder.id },
      data: {
        billingWorkStatus: "ESCALATED",
        billingEscalatedAt: now,
        billingLastActivityAt: now,
        internalNote: reason ? String(reason).trim() : preorder.internalNote,
      },
    });

    await tx.preorderLog.create({
      data: {
        preorderId: preorder.id,
        action: "ESCALATE_BILLING",
        note: reason || "Dossier escaladé",
        actorAdminId: userId || null,
        meta: {
          billingWorkStatus: "ESCALATED",
        },
      },
    });

    return saved;
  });

  return updated;
}

module.exports = {
  claimNextPreorderForInvoicer,
  startBillingWork,
  releaseBillingWork,
  escalateBillingWork,
  releaseExpiredAssignments,
  isBillingActiveStatus,
};