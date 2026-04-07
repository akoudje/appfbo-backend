const {
  subscribeRealtimeEvents,
  recordAlertPlayback,
  getRealtimeHealth,
} = require("../../services/realtime-events.service");

function stream(req, res) {
  subscribeRealtimeEvents({ req, res });
}

function health(req, res) {
  return res.json(getRealtimeHealth());
}

function ackAlertPlayback(req, res) {
  const body = req.body || {};
  const entry = recordAlertPlayback({
    eventKey: body.eventKey,
    orderId: body.orderId || null,
    countryId: req.countryId || req.country?.id || body.countryId || null,
    workspace: body.workspace || null,
    played: body.played !== false,
    reason: body.reason || null,
    actorAdminId: req.user?.id || null,
  });

  return res.json({
    ok: true,
    audit: entry,
  });
}

module.exports = {
  stream,
  health,
  ackAlertPlayback,
};
