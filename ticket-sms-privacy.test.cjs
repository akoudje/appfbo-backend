const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const phone = require('./src/utils/phone');

function fixture(failed = false) {
  const logs = [], module = { exports: {} };
  const env = { ORANGE_CLIENT_ID: 'test', ORANGE_CLIENT_SECRET: 'test', ORANGE_SENDER_ADDRESS: 'test', ORANGE_SENDER_NUMBER: 'test', ORANGE_SMS_TRANSIENT_RETRIES: '0' };
  const fakeRequire = id => {
    if (id === '../utils/phone') return phone;
    if (id === 'axios') return {};
    if (id === './sms.orange.service') return {
      MAX_SMS_LENGTH: 160,
      clampSmsContent: value => value.slice(0, 160),
      getCountryOrangeConfig: () => ({ senderAddress: 'test' }),
      sendText: async () => {
        if (failed) throw Object.assign(new Error('provider echoed OTP 123456 and phone 0700000000'), { code: 'REJECTED' });
        return { trackingUrl: 'https://provider.example.test/tracking/test', raw: {} };
      },
    };
    throw new Error('Unmocked dependency ' + id);
  };
  vm.runInNewContext(`(function(require,module){${fs.readFileSync('./src/services/sms.service.js', 'utf8')}\n})`, {
    process: { env }, console: Object.fromEntries(['log', 'warn', 'error'].map(key => [key, (...args) => logs.push(args)])), setTimeout, URL,
  })(fakeRequire, module);
  return { sms: module.exports, logs };
}
test('OTP transport masks destination and never logs code or provider text on success and failure', async () => {
  for (const failed of [false, true]) {
    const f = fixture(failed);
    const result = await f.sms.sendSms({ to: '0700000000', countryCode: 'CIV', message: 'OTP 123456', sensitive: true });
    assert.equal(result.accepted, !failed);
    const logs = JSON.stringify(f.logs);
    assert.equal(logs.includes('0700000000'), false);
    assert.equal(logs.includes('123456'), false);
    assert.ok(logs.includes('***0000'));
  }
});
test('the existing SMS transport remains compatible when sensitive mode is not requested', async () => {
  const f = fixture(), result = await f.sms.sendSms({ to: '0700000000', message: 'Existing notification' });
  assert.equal(result.accepted, true);
  assert.ok(JSON.stringify(f.logs).includes('+2250700000000'));
});
