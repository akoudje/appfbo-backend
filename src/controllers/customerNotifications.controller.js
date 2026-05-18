const prisma = require("../prisma");
const { getPaymentExpiryHours } = require("../services/notification-template-defaults");

const CIV_ZONE_COUNTRY_CODES = ["CIV", "BEN", "TGO", "NER", "BFA"];

function canonicalFboNumber(raw = "") {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 12) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9, 12)}`;
  }
  return String(raw || "").trim();
}

function dateValue(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function formatFcfa(value) {
  return `${Number(value || 0).toLocaleString("fr-FR")} FCFA`;
}

function formatCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0 min";
  const totalMinutes = Math.ceil(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days}j`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}min`);
  return parts.join(" ");
}

function paymentWindow(order) {
  const status = String(order?.status || "").trim().toUpperCase();
  const paymentStatus = String(order?.paymentStatus || "").trim().toUpperCase();
  if (
    !["INVOICED", "PAYMENT_PENDING"].includes(status) ||
    ["PAID", "PAYMENT_CONFIRMED"].includes(paymentStatus)
  ) {
    return null;
  }

  const explicit = dateValue(order?.paymentExpiresAt);
  const invoiced = dateValue(order?.invoicedAt);
  const hours = Number(order?.paymentExpiryHours || getPaymentExpiryHours());
  const expiresAt =
    explicit ||
    (invoiced && Number.isFinite(hours) && hours > 0
      ? new Date(invoiced.getTime() + hours * 60 * 60 * 1000)
      : null);

  if (!expiresAt) return null;

  const remainingMs = expiresAt.getTime() - Date.now();
  return {
    expired: remainingMs <= 0,
    expiresAt,
    label:
      remainingMs <= 0
        ? `Expirée depuis ${formatCountdown(Math.abs(remainingMs))}`
        : `Expire dans ${formatCountdown(remainingMs)}`,
  };
}

function buildNotificationsFromOrders(orders, numeroFbo) {
  const notifications = [];
  const paymentExpiryHours = getPaymentExpiryHours();

  for (const order of Array.isArray(orders) ? orders : []) {
    const id = order?.id;
    if (!id) continue;

    const relationType = order.fboNumero === numeroFbo ? "SELF" : "PLACED_FOR_OTHER";
    const reference = order?.preorderNumber || "commande";
    const relationLabel =
      relationType === "PLACED_FOR_OTHER"
        ? `pour ${order?.fboNomComplet || order?.fboNumero || "un autre FBO"}`
        : "pour vous";
    const status = String(order?.status || "").trim().toUpperCase();
    const paymentStatus = String(order?.paymentStatus || "").trim().toUpperCase();
    const latestProof = order?.bankPaymentProofs?.[0] || null;
    const enrichedOrder = {
      ...order,
      paymentExpiryHours,
      paymentExpiresAt:
        order?.paymentExpiresAt ||
        (order?.invoicedAt
          ? new Date(new Date(order.invoicedAt).getTime() + paymentExpiryHours * 60 * 60 * 1000)
          : null),
    };
    const windowState = paymentWindow(enrichedOrder);

    if (windowState?.expired) {
      notifications.push({
        key: `${id}:payment-expired`,
        orderId: id,
        preorderNumber: reference,
        relationType,
        severity: "danger",
        title: "Préfacture expirée",
        body: `La préfacture ${reference} ${relationLabel} n'a pas été réglée à temps.`,
        eventAt: windowState.expiresAt || order?.updatedAt || order?.createdAt,
      });
    } else if (windowState) {
      notifications.push({
        key: `${id}:payment-due`,
        orderId: id,
        preorderNumber: reference,
        relationType,
        severity: "warning",
        title: "Paiement en attente",
        body: `${reference} ${relationLabel}: ${windowState.label}. Montant ${formatFcfa(order?.totalFcfa)}.`,
        eventAt: order?.invoicedAt || order?.updatedAt || order?.createdAt,
      });
    }

    if (status === "READY") {
      notifications.push({
        key: `${id}:ready`,
        orderId: id,
        preorderNumber: reference,
        relationType,
        severity: "success",
        title: "Commande prête",
        body: `${reference} ${relationLabel} est prête au retrait.${order?.paymentCollectionCode ? ` Code: ${order.paymentCollectionCode}.` : ""}`,
        eventAt: order?.preparedAt || order?.updatedAt || order?.createdAt,
      });
    }

    if (
      order?.preparationLaunchedAt &&
      !["READY", "FULFILLED", "CANCELLED"].includes(status)
    ) {
      notifications.push({
        key: `${id}:preparation-started`,
        orderId: id,
        preorderNumber: reference,
        relationType,
        severity: "info",
        title: "Préparation lancée",
        body: `${reference} ${relationLabel} est en préparation.`,
        eventAt: order.preparationLaunchedAt,
      });
    }

    if (status === "FULFILLED") {
      notifications.push({
        key: `${id}:fulfilled`,
        orderId: id,
        preorderNumber: reference,
        relationType,
        severity: "success",
        title: "Commande clôturée",
        body: `${reference} ${relationLabel} a été clôturée.`,
        eventAt: order?.fulfilledAt || order?.updatedAt || order?.createdAt,
      });
    }

    if (status === "CANCELLED") {
      notifications.push({
        key: `${id}:cancelled`,
        orderId: id,
        preorderNumber: reference,
        relationType,
        severity: "danger",
        title: "Commande annulée",
        body: `${reference} ${relationLabel} a été annulée.`,
        eventAt: order?.cancelledAt || order?.updatedAt || order?.createdAt,
      });
    }

    if (paymentStatus === "PAID") {
      notifications.push({
        key: `${id}:paid`,
        orderId: id,
        preorderNumber: reference,
        relationType,
        severity: "success",
        title: "Paiement confirmé",
        body: `Le paiement de ${reference} ${relationLabel} est confirmé.`,
        eventAt: order?.paidAt || order?.updatedAt || order?.createdAt,
      });
    }

    const proofStatus = String(latestProof?.status || order?.bankPaymentStatus || "").toUpperCase();
    if (proofStatus === "REJECTED") {
      notifications.push({
        key: `${id}:proof-rejected`,
        orderId: id,
        preorderNumber: reference,
        relationType,
        severity: "danger",
        title: "Preuve bancaire rejetée",
        body: `${reference}: ${latestProof?.rejectionReason || "déposez une nouvelle preuve bancaire."}`,
        eventAt: latestProof?.submittedAt || order?.updatedAt || order?.createdAt,
      });
    }
  }

  return notifications
    .map((notification) => ({
      ...notification,
      id: notification.key,
      eventAt: dateValue(notification.eventAt)?.toISOString() || null,
      sortTime: dateValue(notification.eventAt)?.getTime() || 0,
    }))
    .sort((a, b) => b.sortTime - a.sortTime);
}

async function loadScopedOrdersForCustomer({ fboId, numeroFbo }) {
  const canonicalNumeroFbo = canonicalFboNumber(numeroFbo || "");
  const rows = await prisma.preorder.findMany({
    where: {
      country: { code: { in: CIV_ZONE_COUNTRY_CODES } },
      OR: [
        { fboId },
        ...(canonicalNumeroFbo ? [{ placedByFboNumero: canonicalNumeroFbo }] : []),
      ],
    },
    select: {
      id: true,
      preorderNumber: true,
      status: true,
      paymentStatus: true,
      preorderPaymentMode: true,
      fboNumero: true,
      fboNomComplet: true,
      totalFcfa: true,
      paymentCollectionCode: true,
      invoicedAt: true,
      paidAt: true,
      preparationLaunchedAt: true,
      preparedAt: true,
      fulfilledAt: true,
      cancelledAt: true,
      updatedAt: true,
      createdAt: true,
      bankPaymentStatus: true,
      bankPaymentProofs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          submittedAt: true,
          rejectionReason: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });
  return { rows, numeroFbo: canonicalNumeroFbo };
}

async function loadScopedOrders(req) {
  return loadScopedOrdersForCustomer({
    fboId: req.customer?.fboId,
    numeroFbo: req.customer?.numeroFbo || "",
  });
}

async function buildNotificationSummaryForCustomer({ fboId, numeroFbo }) {
  const { rows, numeroFbo: canonicalNumeroFbo } = await loadScopedOrdersForCustomer({
    fboId,
    numeroFbo,
  });
  const notifications = buildNotificationsFromOrders(rows, canonicalNumeroFbo);
  const reads = notifications.length
    ? await prisma.customerNotificationRead.findMany({
        where: {
          fboId,
          notificationKey: { in: notifications.map((item) => item.key) },
        },
        select: { notificationKey: true },
      })
    : [];
  const readKeys = new Set(reads.map((read) => read.notificationKey));

  return {
    total: notifications.length,
    unreadCount: notifications.filter((item) => !readKeys.has(item.key)).length,
  };
}

async function listMyNotifications(req, res) {
  try {
    const fboId = req.customer?.fboId;
    const { rows, numeroFbo } = await loadScopedOrders(req);
    const notifications = buildNotificationsFromOrders(rows, numeroFbo);
    const reads = await prisma.customerNotificationRead.findMany({
      where: {
        fboId,
        notificationKey: { in: notifications.map((item) => item.key) },
      },
      select: {
        notificationKey: true,
        readAt: true,
      },
    });
    const readByKey = new Map(reads.map((read) => [read.notificationKey, read.readAt]));
    const data = notifications.map((notification) => ({
      ...notification,
      read: readByKey.has(notification.key),
      readAt: readByKey.get(notification.key) || null,
    }));

    return res.json({
      data,
      unreadCount: data.filter((item) => !item.read).length,
    });
  } catch (e) {
    console.error("listMyNotifications error:", e);
    return res.status(500).json({ message: "Erreur serveur (listMyNotifications)" });
  }
}

async function markMyNotificationsRead(req, res) {
  try {
    const fboId = req.customer?.fboId;
    const keys = Array.isArray(req.body?.keys)
      ? req.body.keys.map((key) => String(key || "").trim()).filter(Boolean)
      : [];

    if (!keys.length) {
      return res.status(400).json({ message: "Aucune notification à marquer comme lue." });
    }

    await prisma.customerNotificationRead.createMany({
      data: [...new Set(keys)].map((notificationKey) => ({
        fboId,
        notificationKey,
      })),
      skipDuplicates: true,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("markMyNotificationsRead error:", e);
    return res.status(500).json({ message: "Erreur serveur (markMyNotificationsRead)" });
  }
}

async function markAllMyNotificationsRead(req, res) {
  try {
    const fboId = req.customer?.fboId;
    const { rows, numeroFbo } = await loadScopedOrders(req);
    const notifications = buildNotificationsFromOrders(rows, numeroFbo);

    if (notifications.length) {
      await prisma.customerNotificationRead.createMany({
        data: notifications.map((notification) => ({
          fboId,
          notificationKey: notification.key,
        })),
        skipDuplicates: true,
      });
    }

    return res.json({ ok: true, count: notifications.length });
  } catch (e) {
    console.error("markAllMyNotificationsRead error:", e);
    return res.status(500).json({ message: "Erreur serveur (markAllMyNotificationsRead)" });
  }
}

module.exports = {
  listMyNotifications,
  markMyNotificationsRead,
  markAllMyNotificationsRead,
  buildNotificationSummaryForCustomer,
};
