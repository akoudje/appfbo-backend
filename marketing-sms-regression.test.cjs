const test = require("node:test");
const assert = require("node:assert/strict");
const { isEligibleRecipient } = require("./src/services/marketing-sms-policy");
const phoneNormalized = "+2250700000000";
test("normal sends exclude completed invitations and invalid or duplicate contacts", () => {
  for (const status of ["SENT", "CONFIRMED", "DECLINED", "SKIPPED", "INVALID"]) {
    assert.equal(isEligibleRecipient({ phoneNormalized, status }), false, status);
  }
  for (const status of ["READY", "PENDING", "FAILED"]) {
    assert.equal(isEligibleRecipient({ phoneNormalized, status }), true, status);
  }
});
test("retry sends target only failed contacts with a normalized phone", () => {
  for (const status of ["SENT", "CONFIRMED", "DECLINED", "SKIPPED", "INVALID", "READY", "PENDING"]) {
    assert.equal(isEligibleRecipient({ phoneNormalized, status }, true), false, status);
  }
  assert.equal(isEligibleRecipient({ phoneNormalized, status: "FAILED" }, true), true);
  assert.equal(isEligibleRecipient({ status: "FAILED" }, true), false);
  assert.equal(isEligibleRecipient({ status: "READY" }), false);
});
