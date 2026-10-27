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
// Charge d'un facturier : ses dossiers encore à facturer. Une commande
// facturée en attente de paiement dépend du client, plus du facturier ; une
// commande annulée ou payée peut garder un billingWorkStatus actif (jamais
// remis à zéro) : ni l'une ni l'autre ne doit réduire sa capacité.
const BILLING_LOAD_ORDER_STATUSES = ["SUBMITTED"];
// Rôles servis par la répartition automatique : ils ne se servent plus dans
// la file, l'application leur attribue les dossiers (dispatchBillingQueue).
const BILLING_AUTO_DISPATCH_ROLES = ["FACTURIER_CAISSIER"];
// Rôles qui supervisent la facturation et attribuent les dossiers à la main.
const BILLING_SUPERVISOR_ROLES = ["BILLING_MANAGER", "SALES_DIRECTOR", "SUPER_ADMIN", "TECH_ADMIN"];
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
  if (role === "INVOICER" || role === "FACTURIER_CAISSIER") return 0;
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
      status: { in: BILLING_LOAD_ORDER_STATUSES },
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
      status: { in: BILLING_LOAD_ORDER_STATUSES },
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
    ["INVOICER", "FACTURIER_CAISSIER", "SALES_DIRECTOR"].includes(invoicer.role),
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
  // Dossiers attribués d'office à un facturier caissier encore connecté : ils
  // attendent leur tour dans sa liste, pas d'expiration (sa déconnexion, elle,
  // les remet dans la file : releaseActiveBillingWorkForDisconnectedUser).
  const connectedDispatchIds = (await loadConnectedAutoDispatchInvoicers(countryId)).map((admin) => admin.id);

  const expired = await prisma.preorder.findMany({
    where: {
      countryId,
      assignedInvoicerId: { not: null, notIn: connectedDispatchIds },
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

async function loadConnectedAutoDispatchInvoicers(countryId) {
  const connectedUserIds = normalizeIdList(getConnectedRealtimeUserIds({ countryId }));
  if (!connectedUserIds.length) return [];
  return prisma.adminUser.findMany({
    where: {
      id: { in: connectedUserIds },
      actif: true,
      countryId,
      role: { in: BILLING_AUTO_DISPATCH_ROLES },
    },
    select: { id: true, fullName: true, email: true },
  });
}

async function loadBillingLoads(countryId, userIds) {
  if (!userIds.length) return new Map();
  const loads = await prisma.preorder.groupBy({
    by: ["assignedInvoicerId"],
    where: {
      countryId,
      assignedInvoicerId: { in: userIds },
      status: { in: BILLING_LOAD_ORDER_STATUSES },
      billingWorkStatus: { in: BILLING_ACTIVE_STATUSES },
    },
    _count: { _all: true },
  });
  return new Map(loads.map((item) => [String(item.assignedInvoicerId), Number(item._count?._all || 0)]));
}

// Répartition automatique : chaque facturier caissier connecté est complété
// jusqu'à sa charge maximale, le moins chargé d'abord, dossier par dossier
// dans l'ordre de la file (priorité, puis ancienneté). Le surplus reste en
// file et part au prochain passage (soumission, connexion, minuterie).
const dispatchState = new Map();

async function dispatchBillingQueue({ countryId }) {
  if (!countryId) return { assignedCount: 0 };
  // Un seul passage à la fois par pays ; une demande pendant un passage en
  // relance un juste après (une soumission ne doit pas attendre la minuterie).
  const state = dispatchState.get(countryId) || { running: false, again: false };
  dispatchState.set(countryId, state);
  if (state.running) {
    state.again = true;
    return { assignedCount: 0, deferred: true };
  }
  state.running = true;
  let assignedCount = 0;
  try {
    do {
      state.again = false;
      assignedCount += await dispatchOnce(countryId);
    } while (state.again);
  } finally {
    state.running = false;
  }
  return { assignedCount };
}

async function dispatchOnce(countryId) {
  const invoicers = await loadConnectedAutoDispatchInvoicers(countryId);
  if (!invoicers.length) return 0;

  const { maxActiveBillingPerInvoicer: maxActive } = await getBillingSettings(countryId);
  const loadMap = await loadBillingLoads(countryId, invoicers.map((admin) => admin.id));
  const pool = invoicers.map((admin) => ({ ...admin, load: loadMap.get(admin.id) || 0 }));
  const freeSlots = pool.reduce((sum, admin) => sum + Math.max(0, maxActive - admin.load), 0);
  if (!freeSlots) return 0;

  const candidates = await prisma.preorder.findMany({
    where: {
      countryId,
      status: "SUBMITTED",
      assignedInvoicerId: null,
      billingWorkStatus: { in: BILLING_QUEUE_CLAIMABLE_STATUSES },
    },
    orderBy: [
      { billingPriority: "desc" },
      { submittedAt: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ],
    select: { id: true, billingWorkStatus: true },
    take: freeSlots,
  });

  // Dossier remis en file par un facturier (libération, déconnexion, expiration) :
  // on évite de le lui rendre aussitôt si un autre facturier a de la place.
  const releasedIds = candidates.filter((c) => c.billingWorkStatus === "RELEASED").map((c) => c.id);
  const previousInvoicer = new Map();
  if (releasedIds.length) {
    const logs = await prisma.preorderLog.findMany({
      where: { preorderId: { in: releasedIds }, action: "RELEASE_INVOICER" },
      orderBy: { createdAt: "desc" },
      select: { preorderId: true, meta: true },
    });
    for (const log of logs) {
      if (!previousInvoicer.has(log.preorderId)) {
        previousInvoicer.set(log.preorderId, log.meta?.previousAssignedInvoicerId || null);
      }
    }
  }

  let assigned = 0;
  for (const candidate of candidates) {
    const available = pool
      .filter((admin) => admin.load < maxActive)
      .sort((a, b) => a.load - b.load || String(a.fullName || a.email).localeCompare(String(b.fullName || b.email)));
    const previous = previousInvoicer.get(candidate.id);
    const target = available.find((admin) => admin.id !== previous) || available[0];
    if (!target) break;

    const result = await prisma.$transaction(
      (tx) =>
        assignQueuedPreorderToInvoicer({
          tx,
          preorderId: candidate.id,
          countryId,
          userId: target.id,
          actorAdminId: null,
          mode: "AUTO_DISPATCH",
          note: "Précommande attribuée automatiquement (répartition entre facturiers caissiers connectés)",
          maxActive,
        }),
      { timeout: 15000, maxWait: 10000 },
    );
    if (result?.ok) {
      target.load += 1;
      assigned += 1;
    } else if (result?.reason === "MAX_ACTIVE_REACHED") {
      target.load = maxActive;
    }
  }
  return assigned;
}

// Passage périodique, pour chaque pays où un facturier caissier est connecté :
// rattrape les dossiers remis en file (expiration, déconnexion, libération)
// et les places libérées par les dossiers facturés.
function startBillingDispatchScheduler({ intervalMs = 30000 } = {}) {
  const tick = async () => {
    try {
      const connectedUserIds = normalizeIdList(getConnectedRealtimeUserIds());
      if (!connectedUserIds.length) return;
      const admins = await prisma.adminUser.findMany({
        where: { id: { in: connectedUserIds }, actif: true, role: { in: BILLING_AUTO_DISPATCH_ROLES } },
        select: { countryId: true },
      });
      const countryIds = [...new Set(admins.map((admin) => admin.countryId).filter(Boolean))];
      for (const countryId of countryIds) {
        await releaseExpiredAssignments({ countryId });
        await dispatchBillingQueue({ countryId });
      }
    } catch (error) {
      console.error("[billingQueue] dispatch scheduler error:", error);
    }
  };
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

// Attribution manuelle par un superviseur : à un facturier précis, qu'il soit
// libre ou déjà attribué à un autre, sans plafond de charge.
async function assignPreorderToInvoicerManually({ preorderId, invoicerId, countryId, actorAdminId }) {
  const invoicer = await prisma.adminUser.findFirst({
    where: { id: invoicerId, countryId, actif: true, role: { in: BILLING_CONNECTED_ELIGIBLE_ROLES } },
    select: { id: true, fullName: true, email: true },
  });
  if (!invoicer) return { ok: false, reason: "INVOICER_NOT_FOUND" };

  const preorder = await prisma.preorder.findFirst({
    where: { id: preorderId, countryId },
    select: { id: true, status: true, billingWorkStatus: true, assignedInvoicerId: true },
  });
  if (!preorder) return { ok: false, reason: "PREORDER_NOT_FOUND" };
  if (preorder.status !== "SUBMITTED" || !["QUEUED", "RELEASED", "ASSIGNED", "IN_PROGRESS", "WAITING_CUSTOMER_DATA"].includes(preorder.billingWorkStatus)) {
    return { ok: false, reason: "PREORDER_NOT_ASSIGNABLE" };
  }
  if (preorder.assignedInvoicerId === invoicer.id) return { ok: true, unchanged: true };

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.preorder.updateMany({
      where: {
        id: preorder.id,
        status: "SUBMITTED",
        assignedInvoicerId: preorder.assignedInvoicerId,
        billingWorkStatus: preorder.billingWorkStatus,
      },
      data: {
        assignedInvoicerId: invoicer.id,
        assignedAt: now,
        billingWorkStatus: "ASSIGNED",
        billingLastActivityAt: now,
      },
    });
    if (updated.count !== 1) {
      const error = new Error("PREORDER_CHANGED");
      error.code = "PREORDER_CHANGED";
      throw error;
    }
    await tx.preorderLog.create({
      data: {
        preorderId: preorder.id,
        action: "ASSIGN_INVOICER",
        note: `Précommande attribuée manuellement à ${invoicer.fullName || invoicer.email}`,
        actorAdminId,
        meta: {
          assignedInvoicerId: invoicer.id,
          previousAssignedInvoicerId: preorder.assignedInvoicerId || null,
          mode: "MANUAL_ASSIGN",
        },
      },
    });
  });
  return { ok: true };
}

// Facturiers du pays (pour l'attribution manuelle et la supervision) :
// connexion, charge à facturer et charge maximale.
async function listBillingInvoicers({ countryId }) {
  const admins = await prisma.adminUser.findMany({
    where: { countryId, actif: true, role: { in: ["FACTURIER_CAISSIER", "INVOICER"] } },
    select: { id: true, fullName: true, email: true, role: true, lastLoginAt: true },
    orderBy: [{ fullName: "asc" }, { email: "asc" }],
  });
  const connected = new Set(normalizeIdList(getConnectedRealtimeUserIds({ countryId })));
  const loadMap = await loadBillingLoads(countryId, admins.map((admin) => admin.id));
  const { maxActiveBillingPerInvoicer } = await getBillingSettings(countryId);
  return admins.map((admin) => ({
    ...admin,
    connected: connected.has(admin.id),
    autoDispatch: BILLING_AUTO_DISPATCH_ROLES.includes(admin.role),
    load: loadMap.get(admin.id) || 0,
    maxActive: maxActiveBillingPerInvoicer,
  }));
}

async function claimNextPreorderForInvoicer({ userId, countryId }) {
  if (!userId) {
    return {
      ok: false,
      reason: "UNAUTHENTICATED_USER",
    };
  }

  // Nettoyage des attributions expirées : utile mais pas indispensable pour
  // cette prise en charge précise, et observé à plusieurs secondes sur cette
  // base — on le lance en tâche de fond plutôt que de faire attendre
  // l'utilisateur dessus (un dossier expiré pas encore libéré sera repris au
  // prochain passage, sans bloquer celui-ci).
  releaseExpiredAssignments({ countryId }).catch((error) => {
    console.error("[billingQueue] releaseExpiredAssignments error:", error);
  });
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
  }, { timeout: 15000, maxWait: 10000 });
}

// Prise en charge d'un dossier précis choisi dans la file (bouton "Traiter"),
// par opposition à claimNextPreorderForInvoicer qui choisit lui-même le
// prochain dossier prioritaire. Même garde atomique (assignQueuedPreorderToInvoicer
// réaffecte seulement si le dossier est encore libre) : évite que deux
// facturiers qui cliquent "Traiter" sur la même ligne au même moment se
// retrouvent tous les deux à la travailler.
async function claimSpecificPreorderForInvoicer({ preorderId, userId, countryId }) {
  if (!userId) {
    return {
      ok: false,
      reason: "UNAUTHENTICATED_USER",
    };
  }

  releaseExpiredAssignments({ countryId }).catch((error) => {
    console.error("[billingQueue] releaseExpiredAssignments error:", error);
  });
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

  return prisma.$transaction((tx) =>
    assignQueuedPreorderToInvoicer({
      tx,
      preorderId,
      countryId,
      userId,
      actorAdminId: userId,
      mode: "MANUAL_CLAIM",
      note: "Précommande prise en charge depuis la file de facturation",
      maxActive,
    }),
    { timeout: 15000, maxWait: 10000 },
  );
}

// Réservation à l'impression de la file : attribue au facturier, dans l'ordre
// FIFO, les dossiers encore libres correspondant à ses filtres, dans la limite
// de sa capacité (maxActiveBillingPerInvoicer). Chaque attribution garde la
// même garde atomique que "Traiter" : deux facturiers qui impriment au même
// moment ne peuvent pas réserver le même dossier, l'un d'eux passe au suivant.
async function claimPreordersForPrint({ userId, countryId, filterWhere = {}, orderBy }) {
  if (!userId) {
    return {
      ok: false,
      reason: "UNAUTHENTICATED_USER",
    };
  }

  releaseExpiredAssignments({ countryId }).catch((error) => {
    console.error("[billingQueue] releaseExpiredAssignments error:", error);
  });
  const settings = await getBillingSettings(countryId);
  const maxActive = settings.maxActiveBillingPerInvoicer;
  const activeCount = await countActiveAssignments(prisma, { countryId, userId });
  const capacity = Math.max(0, maxActive - activeCount);

  if (!capacity) {
    return { ok: true, claimedCount: 0, activeCount, maxActive, reason: "MAX_ACTIVE_REACHED" };
  }

  // Marge au-delà de la capacité : des candidats peuvent être pris entre-temps.
  const candidates = await prisma.preorder.findMany({
    where: {
      AND: [
        filterWhere,
        {
          countryId,
          status: "SUBMITTED",
          assignedInvoicerId: null,
          billingWorkStatus: { in: BILLING_QUEUE_CLAIMABLE_STATUSES },
        },
      ],
    },
    orderBy,
    select: { id: true },
    take: capacity * 3,
  });

  let claimedCount = 0;
  for (const candidate of candidates) {
    if (claimedCount >= capacity) break;
    const result = await prisma.$transaction(
      (tx) =>
        assignQueuedPreorderToInvoicer({
          tx,
          preorderId: candidate.id,
          countryId,
          userId,
          actorAdminId: userId,
          mode: "PRINT_CLAIM",
          note: "Précommande réservée à l'impression de la file de facturation",
          maxActive,
        }),
      { timeout: 15000, maxWait: 10000 },
    );
    if (result?.ok) claimedCount += 1;
    else if (result?.reason === "MAX_ACTIVE_REACHED") break;
  }

  return {
    ok: true,
    claimedCount,
    activeCount: activeCount + claimedCount,
    maxActive,
  };
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

// Appelé par realtime-events.service.js quand un facturier n'a plus aucune
// connexion temps réel depuis le délai de grâce configuré (déconnexion
// probable, pas un simple refresh de page) : remet ses dossiers encore en
// cours de saisie dans la file partagée, pour qu'un autre facturier
// connecté puisse les reprendre. Les dossiers déjà facturés et en attente
// de paiement (WAITING_PAYMENT) ne sont pas concernés : il n'y a plus de
// saisie en cours dessus.
async function releaseActiveBillingWorkForDisconnectedUser({ userId, countryId }) {
  if (!userId || !countryId) return { releasedCount: 0, releasedIds: [] };

  const active = await prisma.preorder.findMany({
    where: {
      countryId,
      assignedInvoicerId: userId,
      billingWorkStatus: { in: ["ASSIGNED", "IN_PROGRESS", "WAITING_CUSTOMER_DATA"] },
      status: "SUBMITTED",
    },
    select: { id: true },
  });

  if (!active.length) return { releasedCount: 0, releasedIds: [] };

  const now = new Date();
  const releasedIds = [];

  await prisma.$transaction(
    async (tx) => {
      for (const row of active) {
        const released = await tx.preorder.updateMany({
          where: {
            id: row.id,
            countryId,
            assignedInvoicerId: userId,
            billingWorkStatus: { in: ["ASSIGNED", "IN_PROGRESS", "WAITING_CUSTOMER_DATA"] },
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
            note: "Facturier déconnecté : dossier remis dans la file.",
            actorAdminId: null,
            meta: { previousAssignedInvoicerId: userId, mode: "AUTO_DISCONNECT_RELEASE" },
          },
        });

        releasedIds.push(row.id);
      }
    },
    { timeout: 15000, maxWait: 10000 },
  );

  return { releasedCount: releasedIds.length, releasedIds };
}

function normalizeAs400Amount(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

// Détermine le statut de travail vers lequel un dossier doit revenir une fois
// son contentieux clôturé. On ne peut pas se contenter de restaurer l'ancien
// statut car il n'est pas conservé sur la précommande ; on retombe donc sur un
// statut cohérent avec l'état courant du dossier.
function resolveTargetBillingStatus(preorder) {
  if (preorder.paymentStatus === "PAID") return "COMPLETED";
  if (preorder.assignedInvoicerId) return "IN_PROGRESS";
  return "RELEASED";
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
        billingWorkStatus:
          preorder.billingWorkStatus === "ESCALATED"
            ? resolveTargetBillingStatus(preorder)
            : preorder.billingWorkStatus,
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

// Clôture un contentieux générique (dossier escaladé via le bouton "Escalader",
// sans type AS400). Contrairement à resolveAs400CertificationDispute, aucune
// référence/montant n'est requis : on remet simplement le dossier en circuit.
async function resolveBillingEscalation({ preorderId, userId, countryId, note }) {
  const preorder = await prisma.preorder.findFirst({
    where: {
      id: preorderId,
      countryId,
    },
  });

  if (!preorder) throw new Error("PREORDER_NOT_FOUND");

  if (preorder.billingWorkStatus !== "ESCALATED") {
    throw new Error("PREORDER_NOT_ESCALATED");
  }

  const hasOpenAs400Dispute =
    preorder.billingEscalationType === AS400_CERTIFICATION_MISSING_TYPE &&
    AS400_CERTIFICATION_OPEN_STATUSES.includes(preorder.as400CertificationStatus || "");

  if (hasOpenAs400Dispute) {
    const err = new Error(
      "Ce dossier a un contentieux AS400 ouvert : utilisez la reprise AS400 pour le clôturer.",
    );
    err.statusCode = 400;
    throw err;
  }

  const now = new Date();
  const resolutionNote = String(note || "").trim() || "Contentieux clôturé, dossier repris.";
  const nextBillingWorkStatus = resolveTargetBillingStatus(preorder);

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.preorder.update({
      where: { id: preorder.id },
      data: {
        billingWorkStatus: nextBillingWorkStatus,
        billingEscalationType: null,
        billingLastActivityAt: now,
        internalNote: resolutionNote,
      },
    });

    await tx.preorderLog.create({
      data: {
        preorderId: preorder.id,
        action: "RESOLVE_BILLING_ESCALATION",
        note: resolutionNote,
        actorAdminId: userId || null,
        meta: {
          previousBillingWorkStatus: "ESCALATED",
          nextBillingWorkStatus,
          previousBillingEscalationType: preorder.billingEscalationType || null,
        },
      },
    });

    return saved;
  });

  return updated;
}

module.exports = {
  claimNextPreorderForInvoicer,
  claimSpecificPreorderForInvoicer,
  claimPreordersForPrint,
  dispatchBillingQueue,
  startBillingDispatchScheduler,
  assignPreorderToInvoicerManually,
  listBillingInvoicers,
  autoAssignQueuedPreorder,
  BILLING_AUTO_DISPATCH_ROLES,
  BILLING_SUPERVISOR_ROLES,
  startBillingWork,
  releaseBillingWork,
  releaseActiveBillingWorkForDisconnectedUser,
  escalateBillingWork,
  resolveAs400CertificationDispute,
  resolveBillingEscalation,
  releaseExpiredAssignments,
  isBillingActiveStatus,
  AS400_CERTIFICATION_MISSING_TYPE,
  AS400_CERTIFICATION_OPEN_STATUSES,
};
