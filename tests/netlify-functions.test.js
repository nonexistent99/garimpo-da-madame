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
  const companyEvent = lastlink.extractLastlink({
    Id: 'evt-company', Event: 'Purchase_Order_Confirmed',
    Data: { Buyer: { Name: 'Empresa Teste', Email: 'empresa@example.com', PhoneNumber: '11999999999', Document: '11.222.333/0001-81' }, Purchase: { PaymentId: 'pay-company', Price: { Value: 497 } } },
  });
  assert.equal(lastlink.validatePurchase(companyEvent), null);
  assert.equal(companyEvent.buyer.cpf, '11222333000181');
  assert.equal(lastlink.maskCpf(companyEvent.buyer.cpf), '**.***.333/0001-**');
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

test('encaminha autenticação da Lastlink ao backend durante a transição', async t => {
  const helper = await load('netlify/functions/_shared/upstream.mjs');
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let received;
  global.fetch = async (url, options) => {
    received = { url, headers: Object.fromEntries(options.headers), body: options.body };
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await helper.upstream(
    new Request('https://garimpo-da-madame.netlify.app/api/webhooks/lastlink?secret=teste', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lastlink-signature': 'assinatura' },
    }),
    '/api/webhooks/lastlink?secret=teste',
    '{"evento":"teste"}',
  );
  assert.match(received.url, /\/api\/webhooks\/lastlink\?secret=teste$/);
  assert.equal(received.headers['x-lastlink-signature'], 'assinatura');
  assert.equal(received.body, '{"evento":"teste"}');
});
