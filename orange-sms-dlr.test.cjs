const test = require("node:test");
const assert = require("node:assert/strict");
const { mapOrangeDeliveryStatus } = require("./src/services/sms.service");
const { parseOrangeDeliveryPayload } = require("./src/controllers/smsWebhook.controller");

const resourceId = "ed04e764-a248-4280-afee-d9239f6e07cd";

test("Orange delivery statuses map to the phone outcome only", () => {
  assert.equal(mapOrangeDeliveryStatus("DeliveredToTerminal"), "delivered");
  assert.equal(mapOrangeDeliveryStatus("DeliveredToNetwork"), "pending");
  assert.equal(mapOrangeDeliveryStatus("MessageWaiting"), "pending");
  assert.equal(mapOrangeDeliveryStatus("DeliveryImpossible"), "failed");
  assert.equal(mapOrangeDeliveryStatus("DeliveryUncertain"), "unknown");
});

test("Orange Africa deliveryInfoNotification is parsed with its resource id", () => {
  const parsed = parseOrangeDeliveryPayload({
    deliveryInfoNotification: {
      callbackData: resourceId,
      deliveryInfo: { address: "tel:+2250707924232", deliveryStatus: "DeliveredToTerminal" },
    },
  });
  assert.equal(parsed.deliveryStatus, "delivered");
  assert.equal(parsed.providerStatus, "DeliveredToTerminal");
  assert.equal(parsed.requestId, resourceId);
  assert.equal(parsed.recipient, "tel:+2250707924232");
});

test("a preorder id in callbackData is not taken for an Orange resource id", () => {
  const parsed = parseOrangeDeliveryPayload({
    deliveryInfoNotification: {
      callbackData: "cmvt70lzr0b6t3lisvat3re0w",
      deliveryInfo: { deliveryStatus: "DeliveryImpossible" },
    },
  });
  assert.equal(parsed.deliveryStatus, "failed");
  assert.equal(parsed.requestId, null);
  assert.equal(parsed.callbackData, "cmvt70lzr0b6t3lisvat3re0w");
});
