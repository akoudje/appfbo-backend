const test = require('node:test'), assert = require('node:assert/strict');
const phone = require('./src/utils/phone');

test('national numbers keep their existing format in every country', () => {
  assert.equal(phone.normalizeForCountry('07 07 07 07 07', 'CIV'), '+2250707070707');
  assert.equal(phone.normalizeForCountry('70123456', 'BFA'), '+22670123456');
  assert.equal(phone.normalizeForCountry('90123456', 'TGO'), '+22890123456');
  assert.equal(phone.normalizeForCountry('01 97 12 34 56', 'BEN'), '+2290197123456');
  assert.equal(phone.normalizeForCountry('90123456', 'NER'), '+22790123456');
  assert.equal(phone.normalizeForCountry('+33612345678', 'CIV'), '');
});

test('a contact number can come from any country when it carries its prefix', () => {
  assert.equal(phone.normalizeInternationalPhone('+33 6 12 34 56 78', 'CIV'), '+33612345678');
  assert.equal(phone.normalizeInternationalPhone('0033612345678', 'BFA'), '+33612345678');
  assert.equal(phone.normalizeInternationalPhone('+226 70 12 34 56', 'CIV'), '+22670123456');
  assert.equal(phone.normalizeInternationalPhone('0707070707', 'CIV'), '+2250707070707');
  for (const invalid of ['', 'abc', '123', '+33 1', 'x'.repeat(50)]) assert.equal(phone.normalizeInternationalPhone(invalid, 'CIV'), '');
  assert.equal(phone.isNationalPhone('+2250707070707', 'CIV'), true);
  assert.equal(phone.isNationalPhone('+22670123456', 'CIV'), false);
  assert.equal(phone.phoneRegion('+33612345678'), 'FR');
});

test('a foreign number is always the WhatsApp number', () => {
  const contact = phone.resolveContactPhones({ phone: '+33612345678', whatsapp: '0707070707', whatsappSameAsPhone: false }, 'CIV');
  assert.deepEqual(contact, { ok: true, phone: '+33612345678', whatsapp: '+33612345678', national: false });
});

test('a national number has an optional, possibly foreign, WhatsApp number', () => {
  assert.equal(phone.resolveContactPhones({ phone: '0707070707', whatsappSameAsPhone: true }, 'CIV').whatsapp, '+2250707070707');
  assert.equal(phone.resolveContactPhones({ phone: '0707070707' }, 'CIV').whatsapp, null);
  assert.equal(phone.resolveContactPhones({ phone: '0707070707', whatsapp: '+33612345678' }, 'CIV').whatsapp, '+33612345678');
  assert.equal(phone.resolveContactPhones({ phone: '0707070707', whatsapp: '12' }, 'CIV').code, 'WHATSAPP_INVALID');
});

test('a missing or invalid phone is refused with a distinct code', () => {
  assert.equal(phone.resolveContactPhones({}, 'CIV').code, 'PHONE_REQUIRED');
  assert.equal(phone.resolveContactPhones({ phone: '+33 1' }, 'CIV').code, 'PHONE_INVALID');
});
