const listeners = new Map();
let nextListenerId = 1;

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

  const cleanup = () => {
    listeners.delete(listenerId);
  };

  req.on("close", cleanup);
  req.on("end", cleanup);
  req.on("error", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
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
    }
  }
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
};
