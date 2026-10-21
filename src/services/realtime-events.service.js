const prisma = require("../prisma");
const { getEffectivePermissions, Permission } = require("../auth/permissions");
const listeners = new Map();
let nextListenerId = 1;

// Déconnexion d'un facturier (plus aucune connexion temps réel) : ses
// dossiers de facturation en cours de saisie sont remis dans la file
// partagée après un délai de grâce, pour ne pas les bloquer indéfiniment
// sans réagir à un simple rafraîchissement de page. Voir cleanup() et
// subscribeRealtimeEvents() ci-dessous ; la libération elle-même vit dans
// billingQueue.service.js (require tardif pour éviter une dépendance
// circulaire : ce fichier-ci exporte déjà getConnectedRealtimeUserIds,
// utilisé par billingQueue.service.js).
const pendingDisconnectReleases = new Map();

function isDisconnectReleaseEnabled() {
  return String(process.env.BILLING_DISCONNECT_RELEASE_ENABLED ?? "true").toLowerCase() === "true";
}

function getDisconnectReleaseGraceMs() {
  const minutes = Number.parseFloat(process.env.BILLING_DISCONNECT_RELEASE_GRACE_MINUTES ?? "3");
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 3) * 60 * 1000;
}

function isUserStillConnected(userId) {
  for (const listener of listeners.values()) {
    if (listener.userId === userId) return true;
  }
  return false;
}

async function releaseBillingWorkForDisconnectedUser(userId, countryId) {
  try {
    const { releaseActiveBillingWorkForDisconnectedUser } = require("./billingQueue.service");
    const result = await releaseActiveBillingWorkForDisconnectedUser({ userId, countryId });
    if (result?.releasedCount) {
      console.log("[realtime] billing work released after disconnect", {
        userId,
        countryId,
        releasedCount: result.releasedCount,
      });
      for (const preorderId of result.releasedIds || []) {
        publishRealtimeEvent({
          countryId,
          eventKey: "billing_queue_new",
          orderId: preorderId,
          meta: {
            billingWorkStatus: "RELEASED",
            assignedInvoicerId: null,
            autoAssigned: false,
            reason: "DISCONNECT",
          },
        });
      }
    }
  } catch (error) {
    console.error("[realtime] releaseBillingWorkForDisconnectedUser error:", error);
  }
}

function scheduleDisconnectRelease(userId, countryId) {
  if (!isDisconnectReleaseEnabled() || !userId) return;
  if (isUserStillConnected(userId)) return; // autre onglet/appareil encore connecté
  if (pendingDisconnectReleases.has(userId)) return; // déjà programmé

  const timer = setTimeout(() => {
    pendingDisconnectReleases.delete(userId);
    if (!isUserStillConnected(userId)) {
      void releaseBillingWorkForDisconnectedUser(userId, countryId);
    }
  }, getDisconnectReleaseGraceMs());

  if (typeof timer.unref === "function") timer.unref();
  pendingDisconnectReleases.set(userId, timer);
}

function cancelPendingDisconnectRelease(userId) {
  const timer = pendingDisconnectReleases.get(userId);
  if (!timer) return;
  clearTimeout(timer);
  pendingDisconnectReleases.delete(userId);
}

const stats = {
  connectedTotal: 0,
  disconnectedTotal: 0,
  publishedTotal: 0,
  deliveredTotal: 0,
  droppedTotal: 0,
  lastPublishedAt: null,
  lastDisconnectAt: null,
  disconnectReasons: {},
};

const playbackAuditBuffer = [];
const MAX_AUDIT_EVENTS = 500;

function sendSse(res, payload, eventName = "message") {
  try {
    if (!res || res.writableEnded || res.destroyed) return false;
    if (eventName) {
      res.write(`event: ${eventName}\n`);
    }
    res.write(`data: ${JSON.stringify(payload || {})}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function subscribeRealtimeEvents({ req, res }) {
  const listenerId = String(nextListenerId++);
  const listener = {
    id: listenerId,
    userId: req.user?.id || null,
    countryId: req.countryId || req.country?.id || null,
    res,
    createdAt: Date.now(),
    sessionVersion: req.user?.tokenSessionVersion ?? 0,
    expiresAt: req.user?.tokenExpiresAt || null,
  };

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  listeners.set(listenerId, listener);
  stats.connectedTotal += 1;
  if (listener.userId) cancelPendingDisconnectRelease(listener.userId);

  sendSse(
    res,
    {
      type: "CONNECTED",
      listenerId,
      countryId: listener.countryId,
      at: new Date().toISOString(),
    },
    "connected",
  );

  const cleanup = (reason = "unknown") => {
    if (!listeners.has(listenerId)) return;
    listeners.delete(listenerId);
    stats.disconnectedTotal += 1;
    stats.lastDisconnectAt = new Date().toISOString();
    const key = String(reason || "unknown").toLowerCase();
    stats.disconnectReasons[key] = (stats.disconnectReasons[key] || 0) + 1;
    if (listener.userId) scheduleDisconnectRelease(listener.userId, listener.countryId);
  };

  listener.close = (reason) => {
    cleanup(reason);
    try {
      res.end();
    } catch {
      /* The socket may already be closed. */
    }
  };

  req.on("close", () => cleanup("req_close"));
  req.on("end", () => cleanup("req_end"));
  req.on("error", () => cleanup("req_error"));
  res.on("close", () => cleanup("res_close"));
  res.on("error", () => cleanup("res_error"));
}

function publishRealtimeEvent(event = {}) {
  const payload = {
    type: "ALERT",
    eventKey: String(event.eventKey || "system_event"),
    orderId: event.orderId || null,
    countryId: event.countryId || null,
    meta: event.meta || null,
    at: event.at || new Date().toISOString(),
  };
  stats.publishedTotal += 1;
  stats.lastPublishedAt = payload.at;

  for (const [, listener] of listeners.entries()) {
    if (
      !listener?.res ||
      listener.res.writableEnded ||
      listener.res.destroyed
    ) {
      // Route via close() plutôt qu'une suppression directe de la Map, pour
      // que la libération des dossiers après déconnexion (cleanup()) se
      // déclenche aussi quand c'est ici qu'on détecte la connexion morte.
      listener.close?.("dead_on_publish");
      continue;
    }

    if (
      payload.countryId &&
      listener.countryId &&
      String(payload.countryId) !== String(listener.countryId)
    ) {
      continue;
    }

    const ok = sendSse(listener.res, payload, "alert");
    if (!ok) {
      listener.close?.("send_failed");
      stats.droppedTotal += 1;
    } else {
      stats.deliveredTotal += 1;
    }
  }
}

function recordAlertPlayback(event = {}) {
  const entry = {
    at: new Date().toISOString(),
    eventKey: String(event.eventKey || "unknown"),
    orderId: event.orderId || null,
    countryId: event.countryId || null,
    workspace: event.workspace || null,
    played: Boolean(event.played),
    reason: event.reason ? String(event.reason) : null,
    actorAdminId: event.actorAdminId || null,
  };

  playbackAuditBuffer.unshift(entry);
  if (playbackAuditBuffer.length > MAX_AUDIT_EVENTS) {
    playbackAuditBuffer.length = MAX_AUDIT_EVENTS;
  }

  return entry;
}

function getRealtimeHealth() {
  return {
    activeListeners: listeners.size,
    listeners: Array.from(listeners.values()).map((item) => ({
      id: item.id,
      userId: item.userId,
      countryId: item.countryId,
      connectedAt: new Date(item.createdAt).toISOString(),
      connectedForMs: Math.max(
        0,
        Date.now() - Number(item.createdAt || Date.now()),
      ),
    })),
    stats: { ...stats },
    recentPlaybackAudit: playbackAuditBuffer.slice(0, 50),
  };
}

function getConnectedRealtimeUserIds({ countryId } = {}) {
  const ids = new Set();
  const normalizedCountryId = countryId ? String(countryId) : null;

  for (const listener of listeners.values()) {
    const listenerUserId = listener?.userId ? String(listener.userId) : null;
    if (!listenerUserId) continue;

    if (
      normalizedCountryId &&
      listener?.countryId &&
      String(listener.countryId) !== normalizedCountryId
    ) {
      continue;
    }

    ids.add(listenerUserId);
  }

  return Array.from(ids);
}

function disconnectRealtimeUser(userId) {
  for (const listener of [...listeners.values()])
    if (listener.userId === userId) listener.close?.("session_revoked");
}
let validatingSessions = false;
async function validateRealtimeSessions() {
  if (validatingSessions || !listeners.size) return;
  validatingSessions = true;
  try {
    const ids = [
      ...new Set(
        [...listeners.values()].map((item) => item.userId).filter(Boolean),
      ),
    ];
    if (!ids.length) return;
    const users = await prisma.adminUser.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        role: true,
        actif: true,
        countryId: true,
        sessionVersion: true,
        permissionAllow: true,
        permissionDeny: true,
      },
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    for (const listener of [...listeners.values()]) {
      if (!listener.userId) continue;
      const user = byId.get(listener.userId);
      if (
        !user?.actif ||
        (user.sessionVersion ?? 0) !== listener.sessionVersion ||
        (listener.expiresAt && Date.now() >= listener.expiresAt * 1000) ||
        !getEffectivePermissions(
          user.role,
          user.permissionAllow,
          user.permissionDeny,
        ).includes(Permission.PREORDER_READ) ||
        (user.role !== "SUPER_ADMIN" && user.countryId !== listener.countryId)
      )
        listener.close?.("session_revoked");
    }
  } catch (error) {
    console.error("Realtime session validation failed:", error.message);
    for (const listener of [...listeners.values()])
      listener.close?.("session_validation_error");
  } finally {
    validatingSessions = false;
  }
}
const heartbeatTimer = setInterval(() => {
  void validateRealtimeSessions();
  const pingPayload = { type: "PING", at: new Date().toISOString() };
  for (const [, listener] of listeners.entries()) {
    if (
      !listener?.res ||
      listener.res.writableEnded ||
      listener.res.destroyed
    ) {
      listener.close?.("heartbeat_dead");
      continue;
    }
    const ok = sendSse(listener.res, pingPayload, "ping");
    if (!ok) listener.close?.("heartbeat_send_failed");
  }
}, 25000);

if (typeof heartbeatTimer.unref === "function") {
  heartbeatTimer.unref();
}

module.exports = {
  disconnectRealtimeUser,
  subscribeRealtimeEvents,
  publishRealtimeEvent,
  recordAlertPlayback,
  getRealtimeHealth,
  getConnectedRealtimeUserIds,
};
