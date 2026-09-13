const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(os.tmpdir(), `garimpo-test-${process.pid}.sqlite`);
process.env.APP_SECRET = 'test-secret-with-more-than-thirty-two-characters';
process.env.ADMIN_PASSWORD = 'Strong-test-password-123!';

const db = require('../src/database/database');
const payment = require('../src/commerce/paymentService');
const security = require('../src/commerce/security');
const nodemailer = require('nodemailer');
const { runEmailWorker } = require('../src/commerce/emailService');
const { processOffer } = require('../src/commerce/offerService');
const { approveOrderFromProvider, buildOffersCsv } = require('../src/commerce/routes');
const lastlink = require('../src/commerce/lastlinkService');
const app = require('../src/server');

test('valida corretamente os dois dígitos do CPF', () => {
  assert.equal(security.isCpfShapeValid('529.982.247-25'), true);
  assert.equal(security.isCpfShapeValid('529.982.247-24'), false);
  assert.equal(security.isCpfShapeValid('111.111.111-11'), false);
});

test('rejeita fraude de valor, moeda, pedido e recebedor', () => {
  process.env.MERCADO_PAGO_COLLECTOR_ID = 'seller-1';
  const order = { id: 'ord_1', amount_cents: 2990, currency: 'BRL' };
  const base = { status: 'approved', external_reference: 'ord_1', transaction_amount: 29.90, currency_id: 'BRL', collector_id: 'seller-1' };
  assert.equal(payment.verifyApprovedPayment(base, order).ok, true);
  for (const bad of [{ ...base, transaction_amount: 1 }, { ...base, currency_id: 'USD' }, { ...base, external_reference: 'ord_2' }, { ...base, collector_id: 'attacker' }]) assert.equal(payment.verifyApprovedPayment(bad, order).ok, false);
});

test('valida assinatura e bloqueia replay temporal', () => {
  const now = Date.now(), ts = String(Math.floor(now / 1000)), requestId = 'req-1', dataId = 'ABC123', secret = 'webhook-secret';
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  assert.equal(payment.validateWebhookSignature({ signature: `ts=${ts},v1=${v1}`, requestId, dataId, secret, now }), true);
  assert.equal(payment.validateWebhookSignature({ signature: `ts=${ts},v1=${v1}`, requestId, dataId, secret, now: now + 11 * 60_000 }), false);
  assert.equal(payment.validateWebhookSignature({ signature: `ts=${ts},v1=${'0'.repeat(64)}`, requestId, dataId, secret, now }), false);
});

test('valida compra única da Lastlink por oferta, produto e valor', () => {
  process.env.LASTLINK_OFFER_ID = 'offer-1';
  process.env.LASTLINK_PRODUCT_ID = 'product-1';
  const event = lastlink.extract({ Id: 'evt-1', Event: 'Purchase_Order_Confirmed', Data: { Products: [{ Id: 'product-1' }], Buyer: { Name: 'Cliente Teste', Email: 'cliente@example.com', PhoneNumber: '+5511999999999', Document: '529.982.247-25' }, Offer: { Id: 'offer-1' }, Purchase: { PaymentId: 'pay-1', Price: { Value: 29.90 }, Payment: { PaymentMethod: 'pix' } } } });
  assert.equal(event.amountCents, 2990);
  assert.equal(lastlink.verifyPurchase(event, { price_cents: 2990 }).ok, true);
  assert.equal(lastlink.verifyPurchase({ ...event, offerId: 'outra' }, { price_cents: 2990 }).reason, 'offer_mismatch');
  assert.equal(lastlink.verifyPurchase(event, { price_cents: 100 }).reason, 'amount_mismatch');
  delete process.env.LASTLINK_OFFER_ID; delete process.env.LASTLINK_PRODUCT_ID;
});

test('aceita valor promocional no plano autenticado e bloqueia checkout de outro plano', () => {
  process.env.LASTLINK_VIP_CHECKOUT_URL = 'https://lastlink.com/p/CVIP12345/checkout-payment/';
  process.env.LASTLINK_STRICT_AMOUNT_VALIDATION = 'false';
  const event = lastlink.extract({ Id: 'evt-vip', Event: 'Purchase_Order_Confirmed', Data: { Buyer: { Name: 'Cliente Teste', Email: 'cliente@example.com', PhoneNumber: '+5511999999999', Document: '529.982.247-25' }, Offer: { Url: 'https://lastlink.com/p/CVIP12345/checkout-payment/' }, Purchase: { PaymentId: 'pay-vip', Price: { Value: 24.25 } } } });
  assert.equal(lastlink.verifyPurchase(event, { price_cents: 9700 }, 'vip').ok, true);
  assert.equal(lastlink.verifyPurchase({ ...event, offerUrl: 'https://lastlink.com/p/COUTRO999/checkout-payment/' }, { price_cents: 9700 }, 'vip').reason, 'checkout_mismatch');
  delete process.env.LASTLINK_VIP_CHECKOUT_URL; delete process.env.LASTLINK_STRICT_AMOUNT_VALIDATION;
});

test('protege APIs legadas, mascara CPF e exige CSRF', async t => {
  await db.ready;
  const server = app.listen(0); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/products`)).status, 401);
  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0]; const { csrf } = await login.json();
  assert.equal((await fetch(`${base}/api/admin/settings`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: '{}' })).status, 403);
  const now = new Date().toISOString(), cid = security.randomId('cus'), oid = security.randomId('ord');
  await db.runQuery('INSERT INTO customers(id,name,email,cpf_encrypted,cpf_hash,cpf_mask,phone,terms_accepted_at,marketing_opt_in,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', [cid,'Teste','t@example.com',security.encryptCpf('52998224725'),security.hashCpf('52998224725'),security.maskCpf('52998224725'),'11999999999',now,0,now]);
  await db.runQuery("INSERT INTO orders(id,customer_id,amount_cents,status,created_at,updated_at) VALUES(?,?,2990,'pending',?,?)", [oid,cid,now,now]);
  const overview = await fetch(`${base}/api/admin/overview`, { headers: { cookie } }); const body = await overview.json();
  assert.equal(body.buyers[0].cpf_mask, '***.982.247-**'); assert.equal(JSON.stringify(body).includes('52998224725'), false); assert.equal(JSON.stringify(body).includes('cpf_encrypted'), false);
  assert.ok(csrf);
});

test('token inválido e expirado nunca revelam convite', async t => {
  await db.ready; await db.runQuery("UPDATE commerce_settings SET invite_url='https://chat.whatsapp.com/TestInvite123' WHERE id=1");
  const now = new Date().toISOString(), cid = security.randomId('cus'), oid = security.randomId('ord'), token = security.randomToken();
  await db.runQuery('INSERT INTO customers(id,name,email,cpf_encrypted,cpf_hash,cpf_mask,phone,terms_accepted_at,marketing_opt_in,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', [cid,'Expirado','e@example.com',security.encryptCpf('52998224725'),security.hashCpf('52998224725'),security.maskCpf('52998224725'),'11999999999',now,0,now]);
  await db.runQuery("INSERT INTO orders(id,customer_id,amount_cents,status,redeem_token_hash,redeem_expires_at,created_at,updated_at) VALUES(?,?,2990,'approved',?,?,?,?)", [oid,cid,security.tokenHash(token),new Date(Date.now()-1000).toISOString(),now,now]);
  const server=app.listen(0);t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}`;
  const invalid=await fetch(`${base}/api/public/redeem/nope`);assert.equal(invalid.status,404);assert.equal((await invalid.text()).includes('TestInvite123'),false);
  const expired=await fetch(`${base}/api/public/redeem/${token}`);assert.equal(expired.status,410);assert.equal((await expired.text()).includes('TestInvite123'),false);
});

test('aprovação consultada é idempotente e cria um único email', async () => {
  await db.ready; process.env.MERCADO_PAGO_COLLECTOR_ID='seller-1';
  const now=new Date().toISOString(),cid=security.randomId('cus'),oid=security.randomId('ord');
  await db.runQuery('INSERT INTO customers(id,name,email,cpf_encrypted,cpf_hash,cpf_mask,phone,terms_accepted_at,marketing_opt_in,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[cid,'Replay','r@example.com',security.encryptCpf('52998224725'),security.hashCpf('52998224725'),security.maskCpf('52998224725'),'11999999999',now,0,now]);
  await db.runQuery("INSERT INTO orders(id,customer_id,amount_cents,currency,status,created_at,updated_at) VALUES(?,?,2990,'BRL','pending',?,?)",[oid,cid,now,now]);
  const original=payment.fetchPayment;payment.fetchPayment=async()=>({id:'pay-replay',status:'approved',external_reference:oid,transaction_amount:29.90,currency_id:'BRL',collector_id:'seller-1'});
  const first=await approveOrderFromProvider('pay-replay');const second=await approveOrderFromProvider('pay-replay');payment.fetchPayment=original;
  assert.equal(first.ok,true);assert.equal(second.replay,true);
  const [{count}]=await db.getQuery('SELECT COUNT(*) count FROM email_jobs WHERE order_id=?',[oid]);assert.equal(count,1);
});

test('resgate válido mostra o convite atual sem estender o prazo', async t => {
  await db.ready; const expires=new Date(Date.now()+60_000).toISOString(),now=new Date().toISOString(),cid=security.randomId('cus'),oid=security.randomId('ord'),token=security.randomToken();
  await db.runQuery('INSERT INTO customers(id,name,email,cpf_encrypted,cpf_hash,cpf_mask,phone,terms_accepted_at,marketing_opt_in,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[cid,'Válido','v@example.com',security.encryptCpf('52998224725'),security.hashCpf('52998224725'),security.maskCpf('52998224725'),'11999999999',now,0,now]);
  await db.runQuery("INSERT INTO orders(id,customer_id,amount_cents,status,redeem_token_hash,redeem_expires_at,created_at,updated_at) VALUES(?,?,2990,'approved',?,?,?,?)",[oid,cid,security.tokenHash(token),expires,now,now]);
  await db.runQuery("UPDATE commerce_settings SET invite_url='https://chat.whatsapp.com/InviteOne' WHERE id=1");
  const server=app.listen(0);t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}`;
  const first=await (await fetch(`${base}/api/public/redeem/${token}`)).json();assert.match(first.inviteUrl,/InviteOne$/);assert.equal(first.expiresAt,expires);
  await db.runQuery("UPDATE commerce_settings SET invite_url='https://chat.whatsapp.com/InviteTwo' WHERE id=1");
  const second=await (await fetch(`${base}/api/public/redeem/${token}`)).json();assert.match(second.inviteUrl,/InviteTwo$/);assert.equal(second.expiresAt,expires);
});

test('sem IA oferta fica em configuração pendente e não entra em publicação', async () => {
  delete process.env.NVIDIA_API_KEY; const id=security.randomId('off'),now=new Date().toISOString();
  await db.runQuery("INSERT INTO store_offers(id,exact_name,price_cents,status,created_at,updated_at) VALUES(?,?,1000,'researching',?,?)",[id,'Produto exato modelo X',now,now]);
  await processOffer(id);const [offer]=await db.getQuery('SELECT status,published_at FROM store_offers WHERE id=?',[id]);assert.equal(offer.status,'configuration_pending');assert.equal(offer.published_at,null);
});

test('exportação inclui informações adicionais e neutraliza fórmulas', () => {
  const csv = buildOffersCsv([{ id: 'off_1', exact_name: '=PRODUTO', price_cents: 149990, status: 'failed', confidence: 0.87, failure_reason: 'Pesquisa falhou', research_json: JSON.stringify({ sources: [{ url: 'https://example.com' }] }), created_at: '2026-09-07T12:00:00.000Z', updated_at: '2026-09-07T12:01:00.000Z' }]);
  assert.match(csv, /Produto informado/);
  assert.match(csv, /"'=PRODUTO"/);
  assert.match(csv, /"1499,90"/);
  assert.match(csv, /https:\/\/example\.com/);
});

test('importa vendas aprovadas da Lastlink sem duplicar nem disparar email', async t => {
  await db.ready;
  const server = app.listen(0); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  const cookie = login.headers.get('set-cookie').split(';')[0]; const { csrf } = await login.json();
  const sale = { paymentId: `historical-${Date.now()}`, name: 'Cliente Histórico', email: 'historico@example.com', cpf: '52998224725', phone: '11999999999', amountCents: 9700, plan: 'vip', purchasedAt: '2026-09-13T02:30:00.000Z' };
  const request = () => fetch(`${base}/api/admin/import/lastlink-sales`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ sales: [sale] }) });
  const first = await (await request()).json(); const second = await (await request()).json();
  assert.equal(first.imported, 1, JSON.stringify(first)); assert.equal(first.skipped, 0);
  assert.equal(second.imported, 0); assert.equal(second.skipped, 1);
  const [order] = await db.getQuery('SELECT status,provider_status,approved_at FROM orders WHERE provider_payment_id=?', [sale.paymentId]);
  assert.equal(order.status, 'approved'); assert.equal(order.provider_status, 'confirmed_vip'); assert.equal(order.approved_at, sale.purchasedAt);
  const [{ count }] = await db.getQuery('SELECT COUNT(*) count FROM email_jobs WHERE order_id=(SELECT id FROM orders WHERE provider_payment_id=?)', [sale.paymentId]);
  assert.equal(count, 0);
});

test('painel reconhece as integrações separadas dos dois planos Lastlink', async t => {
  await db.ready;
  process.env.LASTLINK_VIP_CHECKOUT_URL = 'https://lastlink.com/p/CVIP/checkout-payment/';
  process.env.LASTLINK_CLUBE_CHECKOUT_URL = 'https://lastlink.com/p/CCLUBE/checkout-payment/';
  process.env.LASTLINK_VIP_WEBHOOK_SECRET = 'vip-webhook-secret';
  process.env.LASTLINK_CLUBE_WEBHOOK_SECRET = 'clube-webhook-secret';
  const server = app.listen(0); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const overview = await (await fetch(`${base}/api/admin/overview`, { headers: { cookie } })).json();
  assert.deepEqual({ checkout: overview.integrations.lastlinkCheckout, webhook: overview.integrations.lastlinkWebhook, product: overview.integrations.lastlinkProduct }, { checkout: true, webhook: true, product: true });
  delete process.env.LASTLINK_VIP_CHECKOUT_URL; delete process.env.LASTLINK_CLUBE_CHECKOUT_URL;
  delete process.env.LASTLINK_VIP_WEBHOOK_SECRET; delete process.env.LASTLINK_CLUBE_WEBHOOK_SECRET;
});

test('fila de email agenda retry sem afetar pedido', async () => {
  process.env.BREVO_SMTP_LOGIN='login';process.env.BREVO_SMTP_KEY='key';process.env.EMAIL_FROM='Loja <loja@example.com>';
  const id=security.randomId('mail'),now=new Date().toISOString();
  await db.runQuery("INSERT INTO email_jobs(id,order_id,recipient,subject,body,status,attempts,next_attempt_at,created_at) VALUES(?,?,?,?,?,'pending',0,?,?)",[id,security.randomId('ord'),'x@example.com','Teste','Corpo',now,now]);
  const original=nodemailer.createTransport;nodemailer.createTransport=()=>({sendMail:async()=>{throw new Error('smtp offline')}});
  await runEmailWorker();nodemailer.createTransport=original;
  const [job]=await db.getQuery('SELECT status,attempts,last_error FROM email_jobs WHERE id=?',[id]);assert.equal(job.status,'retry');assert.equal(job.attempts,1);assert.match(job.last_error,/smtp offline/);
});
