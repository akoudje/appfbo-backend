const listeners = new Map();
let nextListenerId = 1;

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
  };

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  listeners.set(listenerId, listener);
  stats.connectedTotal += 1;

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

  for (const [listenerId, listener] of listeners.entries()) {
    if (!listener?.res || listener.res.writableEnded || listener.res.destroyed) {
      listeners.delete(listenerId);
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
      listeners.delete(listenerId);
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
      connectedForMs: Math.max(0, Date.now() - Number(item.createdAt || Date.now())),
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

const heartbeatTimer = setInterval(() => {
  const pingPayload = { type: "PING", at: new Date().toISOString() };
  for (const [listenerId, listener] of listeners.entries()) {
    if (!listener?.res || listener.res.writableEnded || listener.res.destroyed) {
      listeners.delete(listenerId);
      continue;
    }
    const ok = sendSse(listener.res, pingPayload, "ping");
    if (!ok) listeners.delete(listenerId);
  }
}, 25000);

if (typeof heartbeatTimer.unref === "function") {
  heartbeatTimer.unref();
}

module.exports = {
  subscribeRealtimeEvents,
  publishRealtimeEvent,
  recordAlertPlayback,
  getRealtimeHealth,
  getConnectedRealtimeUserIds,
};
