// src/services/billingQueue.service.js
// Service pour gérer la file de précommandes à facturer

const prisma = require("../prisma");
const { Permission, ROLE_PERMISSIONS } = require("../auth/permissions");
const { getConnectedRealtimeUserIds } = require("./realtime-events.service");

const BILLING_QUEUE_CLAIMABLE_STATUSES = ["QUEUED", "RELEASED"];
const BILLING_ACTIVE_STATUSES = [
  "ASSIGNED",
  "IN_PROGRESS",
  "WAITING_CUSTOMER_DATA",
  "WAITING_PAYMENT",
];
const AS400_CERTIFICATION_MISSING_TYPE = "AS400_CERTIFICATION_MISSING";
const AS400_CERTIFICATION_OPEN_STATUSES = ["OPEN", "REPORTED"];
const BILLING_CONNECTED_ELIGIBLE_ROLES = Object.entries(ROLE_PERMISSIONS)
  .filter(([, permissions]) => permissions.includes(Permission.INVOICE_CREATE))
  .map(([role]) => role);

function isBillingActiveStatus(status) {
  return BILLING_ACTIVE_STATUSES.includes(status);
}

function normalizeIdList(values = []) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

async function getBillingSettings(countryId) {
  const settings = await prisma.countrySettings.findUnique({
    where: { countryId },
    select: {
      billingClaimTimeoutMin: true,
      maxActiveBillingPerInvoicer: true,
    },
  });

  return {
    billingClaimTimeoutMin: settings?.billingClaimTimeoutMin || 30,
    maxActiveBillingPerInvoicer: settings?.maxActiveBillingPerInvoicer || 10,
  };
}

function billingAutoAssignPriority(role) {
  if (role === "INVOICER") return 0;
  if (role === "SALES_DIRECTOR") return 1;
  if (role === "BILLING_MANAGER") return 2;
  if (role === "TECH_ADMIN") return 3;
  if (role === "SUPER_ADMIN") return 4;
  return 5;
}

async function countActiveAssignments(tx, { countryId, userId }) {
  return tx.preorder.count({
    where: {
      countryId,
      assignedInvoicerId: userId,
      billingWorkStatus: {
        in: BILLING_ACTIVE_STATUSES,
      },
    },
  });
}

async function loadConnectedBillingInvoicers({
  countryId,
  excludeUserIds = [],
}) {
  const connectedUserIds = normalizeIdList(
    getConnectedRealtimeUserIds({ countryId }),
  ).filter((id) => !excludeUserIds.includes(id));

  if (!connectedUserIds.length) return [];

  const admins = await prisma.adminUser.findMany({
    where: {
      id: { in: connectedUserIds },
      actif: true,
      countryId,
      role: { in: BILLING_CONNECTED_ELIGIBLE_ROLES },
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      lastLoginAt: true,
    },
  });

  if (!admins.length) return [];

  const loads = await prisma.preorder.groupBy({
    by: ["assignedInvoicerId"],
    where: {
      countryId,
      assignedInvoicerId: { in: admins.map((admin) => admin.id) },
      billingWorkStatus: { in: BILLING_ACTIVE_STATUSES },
    },
    _count: { _all: true },
  });

  const loadMap = new Map(
    loads.map((item) => [String(item.assignedInvoicerId), Number(item._count?._all || 0)]),
  );

  return admins
    .map((admin) => ({
      ...admin,
      activeCount: loadMap.get(String(admin.id)) || 0,
    }))
    .sort((a, b) => {
      const rolePriority = billingAutoAssignPriority(a.role) - billingAutoAssignPriority(b.role);
      if (rolePriority !== 0) return rolePriority;
      if (a.activeCount !== b.activeCount) return a.activeCount - b.activeCount;
      const aLogin = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
      const bLogin = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
      if (aLogin !== bLogin) return bLogin - aLogin;
      return String(a.fullName || a.email || a.id).localeCompare(
        String(b.fullName || b.email || b.id),
      );
    });
}

async function assignQueuedPreorderToInvoicer({
  tx,
  preorderId,
  countryId,
  userId,
  actorAdminId = null,
  mode = "AUTO_ASSIGN",
  note = "Précommande attribuée automatiquement à un facturier",
  maxActive,
}) {
  const activeCount = await countActiveAssignments(tx, { countryId, userId });
  if (activeCount >= maxActive) {
    return {
      ok: false,
      reason: "MAX_ACTIVE_REACHED",
      activeCount,
      maxActive,
    };
  }

  const now = new Date();
  const claimed = await tx.preorder.updateMany({
    where: {
      id: preorderId,
      countryId,
      assignedInvoicerId: null,
      status: "SUBMITTED",
      billingWorkStatus: { in: BILLING_QUEUE_CLAIMABLE_STATUSES },
    },
    data: {
      assignedInvoicerId: userId,
      assignedAt: now,
      billingWorkStatus: "ASSIGNED",
      billingLastActivityAt: now,
    },
  });

  if (claimed.count !== 1) {
    return {
      ok: false,
      reason: "PREORDER_NOT_AVAILABLE",
    };
  }

  const updated = await tx.preorder.findUnique({
    where: { id: preorderId },
    include: {
      assignedInvoicer: {
        select: { id: true, fullName: true, email: true, role: true },
      },
    },
  });

  if (!updated) {
    return {
      ok: false,
      reason: "PREORDER_NOT_FOUND",
    };
  }

  await tx.preorderLog.create({
    data: {
      preorderId: updated.id,
      action: "ASSIGN_INVOICER",
      note,
      actorAdminId,
      meta: {
        assignedInvoicerId: userId,
        mode,
      },
    },
  });

  return {
    ok: true,
    preorder: updated,
  };
}

async function autoAssignQueuedPreorder({
  preorderId,
  countryId,
  actorAdminId = null,
  excludeUserIds = [],
}) {
  if (!preorderId || !countryId) {
    return {
      ok: false,
      reason: "MISSING_ASSIGNMENT_CONTEXT",
    };
  }

  await releaseExpiredAssignments({ countryId });
  const settings = await getBillingSettings(countryId);
  const connectedInvoicers = await loadConnectedBillingInvoicers({
    countryId,
    excludeUserIds: normalizeIdList(excludeUserIds),
  });

  if (!connectedInvoicers.length) {
    return {
      ok: false,
      reason: "NO_CONNECTED_INVOICER",
    };
  }

  const primaryInvoicers = connectedInvoicers.filter((invoicer) =>
    ["INVOICER", "SALES_DIRECTOR"].includes(invoicer.role),
  );
  const eligibleInvoicers = primaryInvoicers.length ? primaryInvoicers : connectedInvoicers;

  for (const invoicer of eligibleInvoicers) {
    const result = await prisma.$transaction((tx) =>
      assignQueuedPreorderToInvoicer({
        tx,
        preorderId,
        countryId,
        userId: invoicer.id,
        actorAdminId,
        mode: "AUTO_CONNECTED_BALANCER",
        note: "Précommande attribuée automatiquement à un facturier connecté",
        maxActive: settings.maxActiveBillingPerInvoicer,
      }),
    );

    if (result?.ok) {
      return {
        ...result,
        autoAssigned: true,
      };
    }
  }

  return {
    ok: false,
    reason: "NO_CONNECTED_INVOICER_WITH_CAPACITY",
  };
}

async function releaseExpiredAssignments({ countryId }) {
  const settings = await getBillingSettings(countryId);
  const timeoutMin = settings.billingClaimTimeoutMin;
  const cutoff = new Date(Date.now() - timeoutMin * 60 * 1000);
  const now = new Date();

  const expired = await prisma.preorder.findMany({
    where: {
      countryId,
      assignedInvoicerId: { not: null },
      billingWorkStatus: { in: ["ASSIGNED", "IN_PROGRESS"] },
      billingLastActivityAt: { lt: cutoff },
      status: "SUBMITTED",
    },
    select: {
      id: true,
      assignedInvoicerId: true,
    },
  });

  if (!expired.length) return { releasedCount: 0 };

  await prisma.$transaction(async (tx) => {
    for (const row of expired) {
      const released = await tx.preorder.updateMany({
        where: {
          id: row.id,
          countryId,
          assignedInvoicerId: row.assignedInvoicerId,
          billingWorkStatus: { in: ["ASSIGNED", "IN_PROGRESS"] },
          billingLastActivityAt: { lt: cutoff },
          status: "SUBMITTED",
        },
        data: {
          assignedInvoicerId: null,
          assignedAt: null,
          billingWorkStatus: "RELEASED",
          billingReleasedAt: now,
          billingLastActivityAt: now,
        },
      });

      if (released.count !== 1) continue;

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
  const settings = await getBillingSettings(countryId);
  const maxActive = settings.maxActiveBillingPerInvoicer;
  const activeCount = await countActiveAssignments(prisma, { countryId, userId });

  if (activeCount >= maxActive) {
    return {
      ok: false,
      reason: "MAX_ACTIVE_REACHED",
      activeCount,
      maxActive,
    };
  }

  return prisma.$transaction(async (tx) => {
    const candidates = await tx.preorder.findMany({
      where: {
        countryId,
        status: "SUBMITTED",
        billingWorkStatus: { in: BILLING_QUEUE_CLAIMABLE_STATUSES },
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
      take: 20,
    });

    if (!candidates.length) {
      return {
        ok: false,
        reason: "NO_ORDER_AVAILABLE",
      };
    }

    for (const candidate of candidates) {
      const result = await assignQueuedPreorderToInvoicer({
        tx,
        preorderId: candidate.id,
        countryId,
        userId,
        actorAdminId: userId,
        mode: "AUTO_CLAIM",
        note: "Précommande attribuée automatiquement à un facturier",
        maxActive,
      });

      if (result?.ok) {
        return result;
      }
    }

    return {
      ok: false,
      reason: "NO_ORDER_AVAILABLE",
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
    !["ASSIGNED", "IN_PROGRESS", "WAITING_CUSTOMER_DATA"].includes(
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

function normalizeAs400Amount(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

async function escalateBillingWork({
  preorderId,
  userId,
  countryId,
  reason,
  escalationType,
  as400Reference,
  as400AmountFcfa,
}) {
  const preorder = await prisma.preorder.findFirst({
    where: {
      id: preorderId,
      countryId,
    },
  });

  if (!preorder) throw new Error("PREORDER_NOT_FOUND");

  const now = new Date();
  const normalizedEscalationType = String(escalationType || "").trim().toUpperCase();
  const isAs400CertificationMissing =
    normalizedEscalationType === AS400_CERTIFICATION_MISSING_TYPE;
  const normalizedReference = String(as400Reference || "").trim();
  const normalizedAmount = normalizeAs400Amount(as400AmountFcfa);
  const note = reason || (
    isAs400CertificationMissing
      ? "Facture absente dans l'application de certification AS400."
      : "Dossier escaladé"
  );
  const updateData = {
    billingWorkStatus: "ESCALATED",
    billingEscalatedAt: now,
    billingLastActivityAt: now,
    internalNote: note ? String(note).trim() : preorder.internalNote,
  };

  if (isAs400CertificationMissing) {
    updateData.billingEscalationType = AS400_CERTIFICATION_MISSING_TYPE;
    updateData.as400CertificationStatus = "OPEN";
    updateData.as400CertificationReportedAt = now;
    updateData.as400CertificationReportedById = userId || null;
    updateData.as400CertificationResolvedAt = null;
    updateData.as400CertificationResolvedById = null;
    updateData.as400CertificationNote = note;
    updateData.billingPriority = "URGENT";
    if (normalizedReference) updateData.factureReference = normalizedReference;
    if (normalizedAmount !== null) updateData.as400InvoiceTotalFcfa = normalizedAmount;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.preorder.update({
      where: { id: preorder.id },
      data: updateData,
    });

    await tx.preorderLog.create({
      data: {
        preorderId: preorder.id,
        action: "ESCALATE_BILLING",
        note,
        actorAdminId: userId || null,
        meta: {
          billingWorkStatus: "ESCALATED",
          billingEscalationType: isAs400CertificationMissing
            ? AS400_CERTIFICATION_MISSING_TYPE
            : normalizedEscalationType || null,
          as400CertificationStatus: isAs400CertificationMissing ? "OPEN" : null,
          factureReference: normalizedReference || preorder.factureReference || null,
          as400AmountFcfa: normalizedAmount,
        },
      },
    });

    return saved;
  });

  return updated;
}

async function resolveAs400CertificationDispute({
  preorderId,
  userId,
  countryId,
  note,
  as400Reference,
  as400AmountFcfa,
}) {
  const preorder = await prisma.preorder.findFirst({
    where: {
      id: preorderId,
      countryId,
    },
  });

  if (!preorder) throw new Error("PREORDER_NOT_FOUND");

  if (preorder.billingEscalationType !== AS400_CERTIFICATION_MISSING_TYPE) {
    throw new Error("AS400_CERTIFICATION_DISPUTE_NOT_FOUND");
  }

  if (!AS400_CERTIFICATION_OPEN_STATUSES.includes(preorder.as400CertificationStatus || "")) {
    return preorder;
  }

  const now = new Date();
  const normalizedReference = String(as400Reference || preorder.factureReference || "").trim();
  const normalizedAmount = normalizeAs400Amount(
    as400AmountFcfa !== undefined && as400AmountFcfa !== null
      ? as400AmountFcfa
      : preorder.as400InvoiceTotalFcfa,
  );

  if (!normalizedReference) {
    const err = new Error("La référence AS400 corrigée est obligatoire pour clôturer le contentieux.");
    err.statusCode = 400;
    throw err;
  }

  if (normalizedAmount === null || normalizedAmount <= 0) {
    const err = new Error("Le montant AS400 corrigé est obligatoire pour clôturer le contentieux.");
    err.statusCode = 400;
    throw err;
  }

  const resolutionNote =
    String(note || "").trim() || "Facture reprise dans AS400, contentieux clôturé.";

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.preorder.update({
      where: { id: preorder.id },
      data: {
        factureReference: normalizedReference,
        as400InvoiceTotalFcfa: normalizedAmount,
        as400CertificationStatus: "RESOLVED",
        as400CertificationResolvedAt: now,
        as400CertificationResolvedById: userId || null,
        as400CertificationNote: resolutionNote,
        billingWorkStatus: preorder.paymentStatus === "PAID" ? "COMPLETED" : preorder.billingWorkStatus,
        billingLastActivityAt: now,
      },
    });

    await tx.preorderLog.create({
      data: {
        preorderId: preorder.id,
        action: "ESCALATE_BILLING",
        note: resolutionNote,
        actorAdminId: userId || null,
        meta: {
          billingEscalationType: AS400_CERTIFICATION_MISSING_TYPE,
          as400CertificationStatus: "RESOLVED",
          previousBillingWorkStatus: preorder.billingWorkStatus,
          previousFactureReference: preorder.factureReference || null,
          nextFactureReference: normalizedReference,
          previousAs400InvoiceTotalFcfa: preorder.as400InvoiceTotalFcfa || null,
          nextAs400InvoiceTotalFcfa: normalizedAmount,
        },
      },
    });

    return saved;
  });

  return updated;
}

module.exports = {
  claimNextPreorderForInvoicer,
  autoAssignQueuedPreorder,
  startBillingWork,
  releaseBillingWork,
  escalateBillingWork,
  resolveAs400CertificationDispute,
  releaseExpiredAssignments,
  isBillingActiveStatus,
  AS400_CERTIFICATION_MISSING_TYPE,
  AS400_CERTIFICATION_OPEN_STATUSES,
};
