const {
  subscribeRealtimeEvents,
} = require("../../services/realtime-events.service");

function stream(req, res) {
  subscribeRealtimeEvents({ req, res });
}

module.exports = {
  stream,
};

