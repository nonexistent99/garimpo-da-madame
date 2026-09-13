const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = file => import(pathToFileURL(path.join(__dirname, '..', file)).href);

test('normaliza e valida compra Lastlink recebida pela Netlify', async () => {
  const lastlink = await load('netlify/functions/_shared/lastlink.mjs');
  const event = lastlink.extractLastlink({
    Id: 'evt-1', Event: 'Purchase_Order_Confirmed', CreatedAt: '2026-09-13T12:00:00Z',
    Data: {
      Products: [{ Id: 'product-1' }],
      Buyer: { Name: 'Cliente Teste', Email: 'CLIENTE@example.com', PhoneNumber: '+55 11 99999-9999', Document: '529.982.247-25' },
      Offer: { Id: 'offer-1' },
      Purchase: { PaymentId: 'pay-1', Price: { Value: 97 }, Payment: { PaymentMethod: 'pix' } },
    },
  });
  assert.equal(lastlink.validatePurchase(event), null);
  assert.equal(event.amountCents, 9700);
  assert.equal(event.buyer.email, 'cliente@example.com');
});

test('protege CPF e dados pessoais no armazenamento', async () => {
  const cryptoHelper = await load('netlify/functions/_shared/crypto.mjs');
  const lastlink = await load('netlify/functions/_shared/lastlink.mjs');
  const key = crypto.randomBytes(32).toString('base64');
  const encrypted = cryptoHelper.encryptJson({ name: 'Cliente', email: 'cliente@example.com' }, key);
  assert.deepEqual(cryptoHelper.decryptJson(encrypted, key), { name: 'Cliente', email: 'cliente@example.com' });
  assert.equal(JSON.stringify(encrypted).includes('cliente@example.com'), false);
  assert.equal(lastlink.cpfKey('529.982.247-25', key).includes('52998224725'), false);
  assert.equal(cryptoHelper.hmacHex('payload', 'token').length, 64);
});
