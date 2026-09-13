const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../database/database');
const security = require('./security');
const lastlink = require('./lastlinkService');
const { smtpConfigured, getEmailWorkerStatus } = require('./emailService');
const adminEvents = require('./adminEvents');
const { processOffer, publishOffer, analyzeRealPhoto } = require('./offerService');

const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '../../uploads/real-products');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});
const loginAttempts = new Map();
const staffLoginAttempts = new Map();

function cleanText(value, max = 200) { return String(value || '').trim().slice(0, max); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function validInvite(value) { return !value || /^https:\/\/(chat\.)?whatsapp\.com\/[A-Za-z0-9_-]+/.test(value); }
function maskName(value) { const parts = cleanText(value, 120).split(/\s+/).filter(Boolean); return parts.length ? `${parts[0]}${parts.length > 1 ? ` ${parts.at(-1)[0]}.` : ''}` : 'Cliente'; }
function renderTemplate(template, values) {
  return String(template).replace(/{{(nome|link_acesso|suporte)}}/g, (_, key) => String(values[key] || ''));
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function summarizeWebhookEvent(row) {
  let result = {};
  try { result = JSON.parse(row.result || '{}'); } catch {}
  const source = String(row.event_key || '').startsWith('import:') ? 'import' : 'webhook';
  return {
    source,
    receivedAt: row.received_at,
    processedAt: row.processed_at || null,
    status: row.processed_at ? (result.ok === false ? 'rejected' : 'processed') : 'pending',
    reason: result.reason || null,
  };
}

function spreadsheetCell(value) {
  let text = String(value ?? '').replace(/\0/g, '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function offerResearchDetails(raw) {
  try {
    const research = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    const sources = Array.isArray(research.sources)
      ? research.sources.map(source => typeof source === 'string' ? source : (source.url || source.link || source.source)).filter(Boolean)
      : [];
    return {
      sources: sources.join(' | '),
      imageSource: research.imageSource || research.image_source || research.selectedImageSource || '',
      notes: research.notes || research.summary || research.reason || '',
    };
  } catch {
    return { sources: '', imageSource: '', notes: '' };
  }
}

function buildOffersCsv(offers) {
  const headers = [
    'Código da oferta', 'Produto informado', 'Preço (R$)', 'Status', 'Modelo identificado',
    'Confiança da pesquisa (%)', 'Legenda gerada', 'Tipo de imagem', 'URL da imagem',
    'Foto real salva', 'Fonte da imagem', 'Fontes pesquisadas', 'Observações da pesquisa',
    'Motivo da falha ou pendência', 'Tentativas de publicação', 'Publicado em', 'Criado em',
    'Atualizado em', 'Grupo de acesso',
  ];
  const rows = offers.map(offer => {
    const details = offerResearchDetails(offer.research_json);
    const imageType = offer.real_image_path ? 'Foto real enviada' : (offer.selected_image_url ? 'Imagem de referência pesquisada' : 'Sem imagem');
    return [
      offer.id, offer.exact_name, (Number(offer.price_cents || 0) / 100).toFixed(2).replace('.', ','),
      offer.status, offer.model_identified, offer.confidence == null ? '' : Math.round(Number(offer.confidence) * 100),
      offer.caption, imageType, offer.selected_image_url, offer.real_image_path ? 'Sim' : 'Não',
      details.imageSource, details.sources, details.notes, offer.failure_reason, offer.publish_attempts || 0,
      offer.published_at, offer.created_at, offer.updated_at, offer.access_group_key || 'primary',
    ];
  });
  return '\uFEFF' + [headers, ...rows].map(row => row.map(spreadsheetCell).join(';')).join('\r\n');
}

async function approveOrderFromProvider(providerId) {
  const payment = require('./paymentService');
  const providerPayment = await payment.fetchPayment(providerId);
  const [order] = await db.getQuery('SELECT * FROM orders WHERE id=?', [String(providerPayment.external_reference || '')]);
  if (!order) return { ok: false, reason: 'order_not_found' };
  const verified = payment.verifyApprovedPayment(providerPayment, order);
  if (!verified.ok) {
    await db.runQuery('UPDATE orders SET provider_status=?, updated_at=? WHERE id=?', [providerPayment.status || verified.reason, new Date().toISOString(), order.id]);
    return verified;
  }
  if (order.status === 'approved') return { ok: true, replay: true, orderId: order.id };
  const rawToken = security.randomToken();
  const approvedAt = new Date();
  const expiresAt = new Date(approvedAt.getTime() + 24 * 60 * 60 * 1000);
  const changed = await db.runQuery("UPDATE orders SET status='approved', provider_payment_id=?, provider_status='approved', approved_at=?, redeem_token_hash=?, redeem_expires_at=?, updated_at=? WHERE id=? AND status!='approved'",
    [String(providerPayment.id), approvedAt.toISOString(), security.tokenHash(rawToken), expiresAt.toISOString(), approvedAt.toISOString(), order.id]);
  if (!changed.changes) return { ok: true, replay: true, orderId: order.id };
  const [[customer], [settings]] = await Promise.all([
    db.getQuery('SELECT * FROM customers WHERE id=?', [order.customer_id]), db.getQuery('SELECT * FROM commerce_settings WHERE id=1'),
  ]);
  const accessUrl = `${String(process.env.BASE_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '')}/resgate/${rawToken}`;
  const subject = renderTemplate(settings.email_subject, { nome: customer.name, link_acesso: accessUrl, suporte: settings.support_phone });
  const body = renderTemplate(settings.email_body, { nome: customer.name, link_acesso: accessUrl, suporte: settings.support_phone || 'não configurado' });
  await db.runQuery('INSERT OR IGNORE INTO email_jobs (id,order_id,recipient,subject,body,status,attempts,next_attempt_at,created_at) VALUES (?,?,?,?,?,\'pending\',0,?,?)',
    [security.randomId('mail'), order.id, customer.email, subject, body, approvedAt.toISOString(), approvedAt.toISOString()]);
  adminEvents.publish('email.queued', { orderId: order.id, source: 'mercadopago' });
  adminEvents.publish('purchase.approved', { orderId: order.id, plan: order.access_group_key || 'vip', source: 'mercadopago' });
  return { ok: true, orderId: order.id, accessUrl };
}

async function grantAccess(order, customer) {
  if (order.status === 'approved') return { ok: true, replay: true, orderId: order.id };
  const rawToken = security.randomToken();
  const approvedAt = new Date();
  const expiresAt = new Date(approvedAt.getTime() + 24 * 60 * 60 * 1000);
  const changed = await db.runQuery("UPDATE orders SET status='approved', approved_at=?, redeem_token_hash=?, redeem_expires_at=?, updated_at=? WHERE id=? AND status!='approved'",
    [approvedAt.toISOString(), security.tokenHash(rawToken), expiresAt.toISOString(), approvedAt.toISOString(), order.id]);
  if (!changed.changes) return { ok: true, replay: true, orderId: order.id };
  const [settings] = await db.getQuery('SELECT * FROM commerce_settings WHERE id=1');
  const accessUrl = `${String(process.env.BASE_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '')}/resgate/${rawToken}`;
  const subject = renderTemplate(settings.email_subject, { nome: customer.name, link_acesso: accessUrl, suporte: settings.support_phone });
  const body = renderTemplate(settings.email_body, { nome: customer.name, link_acesso: accessUrl, suporte: settings.support_phone || 'não configurado' });
  await db.runQuery('INSERT OR IGNORE INTO email_jobs (id,order_id,recipient,subject,body,status,attempts,next_attempt_at,created_at) VALUES (?,?,?,?,?,\'pending\',0,?,?)',
    [security.randomId('mail'), order.id, customer.email, subject, body, approvedAt.toISOString(), approvedAt.toISOString()]);
  adminEvents.publish('email.queued', { orderId: order.id, source: 'lastlink' });
  return { ok: true, orderId: order.id, accessUrl };
}

async function queueOrderAccessEmail(orderId) {
  const [order] = await db.getQuery(`SELECT o.*,c.name,c.email
    FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?`, [orderId]);
  if (!order) throw httpError(404, 'Pedido não encontrado.');
  if (order.status !== 'approved') throw httpError(409, 'O acesso só pode ser enviado para uma compra aprovada.');
  if (!smtpConfigured()) throw httpError(409, 'Configure o Brevo SMTP antes de enviar notificações.');

  const [settings] = await db.getQuery('SELECT * FROM commerce_settings WHERE id=1');
  if (!settings?.invite_url) throw httpError(409, 'Configure o convite do WhatsApp antes de gerar o acesso.');

  const rawToken = security.randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const accessUrl = `${String(process.env.BASE_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '')}/resgate/${rawToken}`;
  const subject = renderTemplate(settings.email_subject, { nome: order.name, link_acesso: accessUrl, suporte: settings.support_phone });
  const body = renderTemplate(settings.email_body, { nome: order.name, link_acesso: accessUrl, suporte: settings.support_phone || 'não configurado' });
  const [existingJob] = await db.getQuery('SELECT id FROM email_jobs WHERE order_id=?', [order.id]);

  await db.runQuery('UPDATE orders SET redeem_token_hash=?,redeem_expires_at=?,updated_at=? WHERE id=?',
    [security.tokenHash(rawToken), expiresAt.toISOString(), now.toISOString(), order.id]);
  if (existingJob) {
    await db.runQuery("UPDATE email_jobs SET recipient=?,subject=?,body=?,status='pending',attempts=0,next_attempt_at=?,last_error=NULL,sent_at=NULL WHERE id=?",
      [order.email, subject, body, now.toISOString(), existingJob.id]);
  } else {
    await db.runQuery("INSERT INTO email_jobs (id,order_id,recipient,subject,body,status,attempts,next_attempt_at,created_at) VALUES (?,?,?,?,?,'pending',0,?,?)",
      [security.randomId('mail'), order.id, order.email, subject, body, now.toISOString(), now.toISOString()]);
  }

  adminEvents.publish('email.queued', { orderId: order.id, source: 'admin' });
  return { ok: true, orderId: order.id, emailStatus: 'pending', expiresAt: expiresAt.toISOString() };
}

function registerCommerceRoutes(app) {
  app.get('/api/public/offer', async (_req, res) => {
    await db.ready;
    const [s] = await db.getQuery("SELECT access_name,access_description,price_cents,sales_status,support_phone,CASE WHEN invite_url IS NOT NULL AND invite_url != '' THEN 1 ELSE 0 END has_invite FROM commerce_settings WHERE id=1");
    const providerReady = lastlink.checkoutConfigured() && /^https:\/\//.test(process.env.BASE_PUBLIC_URL || '');
    const isLastlinkUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' && /(^|\.)lastlink\.com$/i.test(url.hostname); } catch { return false; } };
    const vipCheckout = process.env.LASTLINK_VIP_CHECKOUT_URL || process.env.LASTLINK_CHECKOUT_URL || '';
    const clubCheckout = process.env.LASTLINK_CLUBE_CHECKOUT_URL || '';
    res.json({
      ...s,
      configured: !!(s.price_cents && s.sales_status === 'active' && s.has_invite && s.support_phone && smtpConfigured() && providerReady),
      paymentProvider: 'Lastlink',
      checkoutUrl: providerReady ? process.env.LASTLINK_CHECKOUT_URL : null,
      checkoutUrls: { vip: isLastlinkUrl(vipCheckout) ? vipCheckout : null, clube: isLastlinkUrl(clubCheckout) ? clubCheckout : null },
    });
  });

  app.post('/api/public/orders', async (req, res) => {
    return res.status(410).json({ error: 'O checkout agora é realizado diretamente pela Lastlink.' });
    /* istanbul ignore next -- fluxo legado mantido temporariamente para referência de migração */
    await db.ready;
    if (!process.env.APP_SECRET || process.env.APP_SECRET.length < 32 || !process.env.MERCADO_PAGO_ACCESS_TOKEN || !process.env.MERCADO_PAGO_WEBHOOK_SECRET || !process.env.MERCADO_PAGO_COLLECTOR_ID || !/^https:\/\//.test(process.env.BASE_PUBLIC_URL || '')) return res.status(503).json({ error: 'Checkout ainda não configurado pela loja.' });
    const [settings] = await db.getQuery('SELECT * FROM commerce_settings WHERE id=1');
    if (settings.sales_status !== 'active' || !settings.price_cents || !settings.invite_url || !settings.support_phone || !smtpConfigured()) return res.status(409).json({ error: 'As vendas ainda não estão abertas.' });
    const name = cleanText(req.body.name, 120), email = cleanText(req.body.email, 180).toLowerCase();
    const cpf = security.normalizeCpf ? security.normalizeCpf(req.body.cpf) : String(req.body.cpf || '').replace(/\D/g, '');
    const phone = String(req.body.phone || '').replace(/\D/g, '').slice(0, 15);
    if (name.length < 3 || !validEmail(email) || !security.isCpfShapeValid(cpf) || phone.length < 10 || req.body.terms !== true) {
      return res.status(422).json({ error: 'Confira nome, email, CPF, WhatsApp e aceite dos termos.' });
    }
    const now = new Date().toISOString(), customerId = security.randomId('cus'), orderId = security.randomId('ord');
    await db.runQuery('INSERT INTO customers (id,name,email,cpf_encrypted,cpf_hash,cpf_mask,phone,terms_accepted_at,marketing_opt_in,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [customerId, name, email, security.encryptCpf(cpf), security.hashCpf(cpf), security.maskCpf(cpf), phone, now, req.body.marketing === true ? 1 : 0, now]);
    await db.runQuery('INSERT INTO orders (id,customer_id,amount_cents,currency,status,created_at,updated_at) VALUES (?,?,?,\'BRL\',\'pending\',?,?)', [orderId, customerId, settings.price_cents, now, now]);
    try {
      const pix = await payment.createPix({ id: orderId, amount_cents: settings.price_cents, description: settings.access_name }, { name, email, cpf });
      await db.runQuery('UPDATE orders SET provider_payment_id=?,provider_status=?,pix_code=?,pix_qr_base64=?,updated_at=? WHERE id=?', [pix.id, pix.status, pix.qrCode, pix.qrBase64, new Date().toISOString(), orderId]);
      res.status(201).json({ orderId, status: pix.status, pixCode: pix.qrCode, pixQrBase64: pix.qrBase64, amountCents: settings.price_cents });
    } catch (error) {
      await db.runQuery("UPDATE orders SET status='configuration_error',provider_status=?,updated_at=? WHERE id=?", [error.code || 'provider_error', new Date().toISOString(), orderId]);
      res.status(error.code === 'PAYMENT_NOT_CONFIGURED' ? 503 : 502).json({ error: error.message, orderId });
    }
  });

  app.get('/api/public/orders/:id', async (req, res) => {
    const [row] = await db.getQuery('SELECT id,status,amount_cents,currency,provider_status,approved_at,redeem_expires_at FROM orders WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Pedido não encontrado.' });
    res.json(row);
  });

  app.get('/api/public/redeem/:token', async (req, res) => {
    const [row] = await db.getQuery(`SELECT o.status,o.approved_at,o.redeem_expires_at,s.invite_url,s.support_phone
      FROM orders o CROSS JOIN commerce_settings s WHERE o.redeem_token_hash=?`, [security.tokenHash(req.params.token)]);
    if (!row) return res.status(404).json({ error: 'Link de acesso inválido.' });
    if (row.status !== 'approved') return res.status(403).json({ error: 'Pagamento ainda não aprovado.' });
    if (new Date(row.redeem_expires_at).getTime() <= Date.now()) return res.status(410).json({ error: 'Esta página de resgate expirou. Fale com o suporte.', supportPhone: row.support_phone });
    if (!row.invite_url) return res.status(503).json({ error: 'Convite temporariamente indisponível. Fale com o suporte.', supportPhone: row.support_phone });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ inviteUrl: row.invite_url, expiresAt: row.redeem_expires_at, supportPhone: row.support_phone });
  });

  app.post('/api/webhooks/mercadopago', async (req, res) => {
    return res.status(410).json({ error: 'Integração substituída pela Lastlink.' });
    /* istanbul ignore next -- fluxo legado mantido temporariamente para conciliação histórica */
    const dataId = req.query['data.id'] || req.body?.data?.id;
    const valid = payment.validateWebhookSignature({ signature: req.headers['x-signature'], requestId: req.headers['x-request-id'], dataId, secret: process.env.MERCADO_PAGO_WEBHOOK_SECRET });
    if (!valid) return res.status(401).json({ error: 'Assinatura inválida.' });
    const eventKey = `${req.headers['x-request-id']}:${dataId}`;
    try { await db.runQuery('INSERT INTO webhook_events(provider,event_key,received_at) VALUES (\'mercadopago\',?,?)', [eventKey, new Date().toISOString()]); }
    catch (error) { if (/UNIQUE|PRIMARY/.test(error.message)) return res.sendStatus(200); throw error; }
    try {
      const result = await approveOrderFromProvider(String(dataId));
      await db.runQuery('UPDATE webhook_events SET processed_at=?,result=? WHERE provider=\'mercadopago\' AND event_key=?', [new Date().toISOString(), JSON.stringify(result), eventKey]);
      res.sendStatus(200);
    } catch (error) {
      await db.runQuery('UPDATE webhook_events SET result=? WHERE provider=\'mercadopago\' AND event_key=?', [String(error.message).slice(0, 200), eventKey]);
      res.sendStatus(500);
    }
  });

  app.post('/api/webhooks/lastlink', async (req, res) => {
    const plan = lastlink.webhookPlan(lastlink.webhookSecret(req));
    if (!plan) return res.status(401).json({ error: 'Webhook não autorizado.' });
    const event = lastlink.extract(req.body || {});
    if (event.isTest) return res.json({ ok: true, test: true });
    if (!event.eventId) return res.status(422).json({ error: 'Evento sem identificador.' });
    try { await db.runQuery('INSERT INTO webhook_events(provider,event_key,received_at) VALUES (\'lastlink\',?,?)', [event.eventId, new Date().toISOString()]); }
    catch (error) { if (/UNIQUE|PRIMARY/i.test(error.message)) return res.sendStatus(200); throw error; }
    try {
      if (['Payment_Refund', 'Payment_Chargeback'].includes(event.event)) {
        const status = event.event === 'Payment_Refund' ? 'refunded' : 'chargeback';
        await db.runQuery('UPDATE orders SET status=?,provider_status=?,updated_at=? WHERE provider_payment_id=?', [status, event.event, new Date().toISOString(), event.paymentId]);
        await db.runQuery('UPDATE webhook_events SET processed_at=?,result=? WHERE provider=\'lastlink\' AND event_key=?', [new Date().toISOString(), JSON.stringify({ ok: true, revoked: true }), event.eventId]);
        adminEvents.publish('purchase.revoked', { status, source: 'lastlink' });
        return res.sendStatus(200);
      }
      const [settings] = await db.getQuery('SELECT * FROM commerce_settings WHERE id=1');
      const verified = lastlink.verifyPurchase(event, settings, plan);
      if (!verified.ok) {
        await db.runQuery('UPDATE webhook_events SET processed_at=?,result=? WHERE provider=\'lastlink\' AND event_key=?', [new Date().toISOString(), JSON.stringify(verified), event.eventId]);
        adminEvents.publish('webhook.rejected', { reason: verified.reason, source: 'lastlink' });
        return res.status(422).json({ error: verified.reason });
      }
      const name = cleanText(event.buyer.name, 120), email = cleanText(event.buyer.email, 180).toLowerCase();
      const cpf = security.normalizeCpf(event.buyer.document); const phone = String(event.buyer.phone || '').replace(/\D/g, '').slice(0, 15);
      if (name.length < 3 || !validEmail(email) || !security.isCpfShapeValid(cpf) || phone.length < 10) return res.status(422).json({ error: 'Dados do comprador incompletos.' });
      const [existing] = await db.getQuery('SELECT * FROM orders WHERE provider_payment_id=?', [event.paymentId]);
      if (existing) {
        const [existingCustomer] = await db.getQuery('SELECT id,name,email,phone FROM customers WHERE id=?', [existing.customer_id]);
        const recovered = await grantAccess(existing, existingCustomer);
        await db.runQuery('UPDATE webhook_events SET processed_at=?,result=? WHERE provider=\'lastlink\' AND event_key=?', [new Date().toISOString(), JSON.stringify({ ok: true, recovered: true, orderId: recovered.orderId }), event.eventId]);
        adminEvents.publish('purchase.updated', { orderId: recovered.orderId, plan, source: 'lastlink' });
        return res.sendStatus(200);
      }
      const now = new Date().toISOString(), customerId = security.randomId('cus'), orderId = security.randomId('ord');
      const customer = { id: customerId, name, email, phone };
      await db.runQuery('INSERT INTO customers (id,name,email,cpf_encrypted,cpf_hash,cpf_mask,phone,terms_accepted_at,marketing_opt_in,created_at) VALUES (?,?,?,?,?,?,?,?,0,?)',
        [customerId, name, email, security.encryptCpf(cpf), security.hashCpf(cpf), security.maskCpf(cpf), phone, event.createdAt || now, now]);
      await db.runQuery("INSERT INTO orders (id,customer_id,access_group_key,amount_cents,currency,status,provider_payment_id,provider_status,created_at,updated_at) VALUES (?,?,?,?,'BRL','pending',?,?,?,?)",
        [orderId, customerId, verified.plan, event.amountCents, event.paymentId, `confirmed_${verified.plan}`, now, now]);
      const result = await grantAccess({ id: orderId, status: 'pending' }, customer);
      await db.runQuery('UPDATE webhook_events SET processed_at=?,result=? WHERE provider=\'lastlink\' AND event_key=?', [new Date().toISOString(), JSON.stringify({ ok: true, orderId }), event.eventId]);
      adminEvents.publish('purchase.approved', { orderId, plan: verified.plan, source: 'lastlink' });
      res.json({ ok: true, orderId: result.orderId });
    } catch (error) {
      await db.runQuery('DELETE FROM webhook_events WHERE provider=\'lastlink\' AND event_key=? AND processed_at IS NULL', [event.eventId]).catch(() => {});
      adminEvents.publish('webhook.failed', { source: 'lastlink' });
      res.sendStatus(500);
    }
  });

  app.post('/api/staff/login', (req, res) => {
    const ip = req.ip; const attempt = staffLoginAttempts.get(ip) || { count: 0, until: 0 };
    if (attempt.until > Date.now()) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    const username = cleanText(req.body.username, 80);
    const expectedUsername = process.env.STAFF_PORTAL_USERNAME || '';
    const expectedPassword = process.env.STAFF_PORTAL_PASSWORD || '';
    if (expectedUsername.length < 3 || expectedPassword.length < 12) return res.status(503).json({ error: 'Acesso das atendentes ainda não configurado.' });
    if (!security.safeEqual(username, expectedUsername) || !security.safeEqual(req.body.password, expectedPassword)) {
      attempt.count += 1; if (attempt.count >= 5) { attempt.until = Date.now() + 15 * 60_000; attempt.count = 0; } staffLoginAttempts.set(ip, attempt);
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }
    staffLoginAttempts.delete(ip); const session = security.createStaffSession();
    res.setHeader('Set-Cookie', `gm_staff=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    res.json({ csrf: session.csrf });
  });
  app.get('/api/staff/session', security.requireStaff, (req, res) => res.json({ authenticated: true, csrf: req.staffSession.csrf }));
  app.post('/api/staff/logout', security.requireStaff, (req, res) => { security.staffSessions.delete(req.staffSession.token); res.setHeader('Set-Cookie', 'gm_staff=; Path=/; Max-Age=0; SameSite=Strict; HttpOnly'); res.json({ ok: true }); });
  app.post('/api/staff/cpf-lookup', security.requireStaff, async (req, res) => {
    const cpf = security.normalizeCpf(req.body.cpf);
    if (!security.isCpfShapeValid(cpf)) return res.status(422).json({ error: 'Informe um CPF válido.' });
    const rows = await db.getQuery(`SELECT c.name,o.status,o.provider_status,o.approved_at,o.redeem_expires_at,o.created_at
      FROM customers c JOIN orders o ON o.customer_id=c.id WHERE c.cpf_hash=? ORDER BY o.created_at DESC LIMIT 1`, [security.hashCpf(cpf)]);
    const order = rows[0];
    if (!order) return res.json({ found: false });
    const purchasedAt = new Date(order.approved_at || order.created_at);
    const validUntil = new Date(purchasedAt); validUntil.setFullYear(validUntil.getFullYear() + 1);
    const active = order.status === 'approved' && validUntil > new Date();
    const plan = order.provider_status === 'confirmed_clube' ? 'Clube Sócio' : 'VIP Garimpo';
    res.json({ found: true, customer: maskName(order.name), cpfLastFive: cpf.slice(-5), plan, status: active ? 'ativo' : 'inativo', purchasedAt: purchasedAt.toISOString(), validUntil: validUntil.toISOString(), invitePageExpiresAt: order.redeem_expires_at || null });
  });

  app.post('/api/admin/login', (req, res) => {
    const ip = req.ip; const attempt = loginAttempts.get(ip) || { count: 0, until: 0 };
    if (attempt.until > Date.now()) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) return res.status(503).json({ error: 'Defina ADMIN_PASSWORD com ao menos 12 caracteres no ambiente.' });
    if (!security.safeEqual(req.body.password, process.env.ADMIN_PASSWORD)) {
      attempt.count += 1; if (attempt.count >= 5) { attempt.until = Date.now() + 15 * 60_000; attempt.count = 0; } loginAttempts.set(ip, attempt);
      return res.status(401).json({ error: 'Senha inválida.' });
    }
    loginAttempts.delete(ip); const session = security.createSession();
    res.setHeader('Set-Cookie', `gm_admin=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    res.json({ csrf: session.csrf });
  });

  app.get('/api/admin/session', security.requireAdmin, (req, res) => res.json({ authenticated: true, csrf: req.adminSession.csrf }));
  app.post('/api/admin/logout', security.requireAdmin, (req, res) => { security.sessions.delete(req.adminSession.token); res.setHeader('Set-Cookie', 'gm_admin=; Path=/; Max-Age=0; SameSite=Strict; HttpOnly'); res.json({ ok: true }); });

  app.get('/api/admin/events', security.requireAdmin, (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = event => res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = adminEvents.subscribe(send);
    send({ id: `connected-${Date.now()}`, type: 'connected', at: new Date().toISOString() });
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  });

  app.get('/api/admin/overview', security.requireAdmin, async (_req, res) => {
    const [[settings], buyers, offers, emailJobs, webhookEvents] = await Promise.all([
      db.getQuery('SELECT * FROM commerce_settings WHERE id=1'),
      db.getQuery(`SELECT o.id,o.amount_cents,o.currency,o.status,o.provider_status,o.access_group_key,o.approved_at,o.redeem_expires_at,o.created_at,o.updated_at,
        c.name,c.email,c.cpf_mask,c.phone,c.marketing_opt_in,e.status email_status,e.attempts email_attempts,e.last_error email_error,
        e.sent_at email_sent_at,e.next_attempt_at email_next_attempt_at,
        CASE WHEN o.redeem_token_hash IS NOT NULL THEN 1 ELSE 0 END has_redeem,
        CASE WHEN o.access_group_key='clube' OR o.provider_status='confirmed_clube' THEN 'clube' ELSE 'vip' END plan_key,
        CASE WHEN imported_event.event_key IS NOT NULL THEN 'import' WHEN o.provider_status LIKE 'confirmed%' THEN 'lastlink' ELSE 'manual' END purchase_source
        FROM orders o JOIN customers c ON c.id=o.customer_id
        LEFT JOIN email_jobs e ON e.order_id=o.id
        LEFT JOIN webhook_events imported_event ON imported_event.provider='lastlink' AND imported_event.event_key=('import:' || o.provider_payment_id)
        ORDER BY o.created_at DESC LIMIT 100`),
      db.getQuery('SELECT * FROM store_offers ORDER BY created_at DESC LIMIT 100'), db.getQuery('SELECT status,COUNT(*) count FROM email_jobs GROUP BY status'),
      db.getQuery("SELECT event_key,received_at,processed_at,result FROM webhook_events WHERE provider='lastlink' ORDER BY received_at DESC LIMIT 25"),
    ]);
    const vipCheckout = !!(process.env.LASTLINK_VIP_CHECKOUT_URL || process.env.LASTLINK_CHECKOUT_URL);
    const clubeCheckout = !!process.env.LASTLINK_CLUBE_CHECKOUT_URL;
    const vipWebhook = !!(process.env.LASTLINK_VIP_WEBHOOK_SECRET || process.env.LASTLINK_WEBHOOK_SECRET);
    const clubeWebhook = !!process.env.LASTLINK_CLUBE_WEBHOOK_SECRET;
    const vipProduct = !!(process.env.LASTLINK_VIP_OFFER_ID || process.env.LASTLINK_VIP_PRODUCT_ID || vipCheckout);
    const clubeProduct = !!(process.env.LASTLINK_CLUBE_OFFER_ID || process.env.LASTLINK_CLUBE_PRODUCT_ID || clubeCheckout);
    const summarizedEvents = webhookEvents.map(summarizeWebhookEvent);
    res.json({ settings, buyers, offers, emailJobs, diagnostics: {
      serverTime: new Date().toISOString(),
      realtime: adminEvents.getStatus(),
      emailWorker: getEmailWorkerStatus(),
      latestWebhook: summarizedEvents.find(event => event.source === 'webhook') || null,
      latestImport: summarizedEvents.find(event => event.source === 'import') || null,
    }, integrations: {
      lastlinkCheckout: vipCheckout && clubeCheckout,
      lastlinkWebhook: vipWebhook && clubeWebhook,
      lastlinkProduct: vipProduct && clubeProduct,
      smtp: smtpConfigured(),
      aiResearch: !!(process.env.NVIDIA_API_KEY && process.env.NVIDIA_TEXT_MODEL && process.env.NVIDIA_VISION_MODEL),
    } });
  });

  app.post('/api/admin/orders/:id/email', security.requireAdmin, async (req, res) => {
    try {
      res.status(202).json(await queueOrderAccessEmail(cleanText(req.params.id, 100)));
    } catch (error) {
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Não foi possível preparar o email de acesso.' });
    }
  });

  app.get('/api/admin/offers/export.csv', security.requireAdmin, async (_req, res) => {
    const offers = await db.getQuery('SELECT * FROM store_offers ORDER BY created_at DESC');
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="produtos-garimpo-${date}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buildOffersCsv(offers));
  });

  app.post('/api/admin/import/lastlink-sales', security.requireAdmin, async (req, res) => {
    const sales = Array.isArray(req.body.sales) ? req.body.sales.slice(0, 500) : [];
    if (!sales.length) return res.status(422).json({ error: 'Envie ao menos uma venda para importar.' });

    const result = { imported: 0, skipped: 0, rejected: [] };
    for (let index = 0; index < sales.length; index += 1) {
      const sale = sales[index] || {};
      const paymentId = cleanText(sale.paymentId, 160);
      const name = cleanText(sale.name, 120);
      const email = cleanText(sale.email, 180).toLowerCase();
      const cpf = security.normalizeCpf(sale.cpf);
      const phone = String(sale.phone || '').replace(/\D/g, '').slice(0, 15);
      const amountCents = Number(sale.amountCents);
      const plan = sale.plan === 'clube' ? 'clube' : 'vip';
      const purchasedAt = new Date(sale.purchasedAt || '');

      if (!paymentId || name.length < 3 || !validEmail(email) || !security.isCpfShapeValid(cpf)
        || phone.length < 10 || !Number.isInteger(amountCents) || amountCents < 1
        || Number.isNaN(purchasedAt.getTime())) {
        result.rejected.push({ row: index + 2, reason: 'Dados obrigatórios inválidos.' });
        continue;
      }

      const [existingOrder] = await db.getQuery('SELECT id FROM orders WHERE provider_payment_id=?', [paymentId]);
      if (existingOrder) {
        result.skipped += 1;
        continue;
      }

      const approvedAt = purchasedAt.toISOString();
      const inviteExpiresAt = new Date(purchasedAt.getTime() + 24 * 60 * 60 * 1000).toISOString();
      const cpfHash = security.hashCpf(cpf);
      let [customer] = await db.getQuery('SELECT id FROM customers WHERE cpf_hash=? ORDER BY created_at DESC LIMIT 1', [cpfHash]);
      let createdCustomer = false;
      if (!customer) {
        customer = { id: security.randomId('cus') };
        await db.runQuery('INSERT INTO customers (id,name,email,cpf_encrypted,cpf_hash,cpf_mask,phone,terms_accepted_at,marketing_opt_in,created_at) VALUES (?,?,?,?,?,?,?,?,0,?)',
          [customer.id, name, email, security.encryptCpf(cpf), cpfHash, security.maskCpf(cpf), phone, approvedAt, approvedAt]);
        createdCustomer = true;
      }

      const orderId = security.randomId('ord');
      try {
        await db.runQuery("INSERT INTO orders (id,customer_id,access_group_key,amount_cents,currency,status,provider_payment_id,provider_status,approved_at,redeem_expires_at,created_at,updated_at) VALUES (?,?,?,?, 'BRL','approved',?,?,?,?,?,?)",
          [orderId, customer.id, plan, amountCents, paymentId, `confirmed_${plan}`, approvedAt, inviteExpiresAt, approvedAt, approvedAt]);
        await db.runQuery("INSERT OR IGNORE INTO webhook_events(provider,event_key,received_at,processed_at,result) VALUES ('lastlink',?,?,?,?)",
          [`import:${paymentId}`, approvedAt, new Date().toISOString(), JSON.stringify({ ok: true, imported: true, orderId })]);
        result.imported += 1;
      } catch (error) {
        if (createdCustomer) await db.runQuery('DELETE FROM customers WHERE id=?', [customer.id]).catch(() => {});
        if (/UNIQUE|PRIMARY/i.test(error.message)) result.skipped += 1;
        else result.rejected.push({ row: index + 2, reason: 'Falha ao salvar a venda.' });
      }
    }

    if (result.imported) adminEvents.publish('purchases.imported', { count: result.imported, source: 'import' });
    res.json(result);
  });

  app.put('/api/admin/settings', security.requireAdmin, async (req, res) => {
    const [current] = await db.getQuery('SELECT * FROM commerce_settings WHERE id=1');
    if (!current) return res.status(503).json({ error: 'As configurações ainda não foram inicializadas.' });
    const has = field => Object.prototype.hasOwnProperty.call(req.body, field);
    const fieldErrors = {};
    const next = {
      accessName: current.access_name, accessDescription: current.access_description,
      priceCents: current.price_cents, salesStatus: current.sales_status,
      inviteUrl: current.invite_url || '', supportPhone: current.support_phone || '',
      destinationGroupId: current.destination_group_id || '', emailSubject: current.email_subject,
      emailBody: current.email_body,
    };
    for (const [field, limit, message] of [
      ['accessName', 120, 'Informe o nome do acesso.'],
      ['accessDescription', 500, 'Informe a descrição do acesso.'],
      ['emailSubject', 180, 'Informe o assunto do e-mail.'],
      ['emailBody', 3000, 'Informe o texto do e-mail.'],
    ]) {
      if (!has(field)) continue;
      const value = cleanText(req.body[field], limit);
      if (value) next[field] = value;
      else fieldErrors[field] = message;
    }
    if (has('priceCents')) {
      const rawPrice = req.body.priceCents;
      const price = rawPrice === null || rawPrice === '' ? null : Number(rawPrice);
      if (price !== null && (!Number.isInteger(price) || price < 100)) fieldErrors.price = 'Informe um preço válido a partir de R$ 1,00.';
      else next.priceCents = price;
    }
    if (has('inviteUrl')) {
      const invite = cleanText(req.body.inviteUrl, 400);
      if (!validInvite(invite)) fieldErrors.inviteUrl = 'Use um link válido iniciado por https://chat.whatsapp.com/.';
      else next.inviteUrl = invite;
    }
    if (has('supportPhone')) next.supportPhone = String(req.body.supportPhone || '').replace(/\D/g, '').slice(0, 15);
    if (has('destinationGroupId')) next.destinationGroupId = cleanText(req.body.destinationGroupId, 120);
    const requestedStatus = has('salesStatus') && ['active', 'paused'].includes(req.body.salesStatus) ? req.body.salesStatus : next.salesStatus;
    next.salesStatus = requestedStatus;
    if (requestedStatus === 'active') {
      const missing = [];
      if (!lastlink.checkoutConfigured() || !/^https:\/\//.test(process.env.BASE_PUBLIC_URL || '')) missing.push('Lastlink');
      if (!next.priceCents) missing.push('preço');
      if (!next.inviteUrl) missing.push('convite do WhatsApp');
      if (next.supportPhone.length < 10) missing.push('WhatsApp do suporte');
      if (!smtpConfigured()) missing.push('Brevo SMTP');
      if (missing.length) {
        next.salesStatus = 'paused';
        fieldErrors.salesStatus = `Os outros dados foram salvos, mas as vendas continuam pausadas. Falta configurar: ${missing.join(', ')}.`;
      }
    }
    const now = new Date().toISOString();
    if (next.inviteUrl !== (current.invite_url || '')) await db.runQuery('INSERT INTO invite_history(id,invite_url,changed_at,changed_by) VALUES (?,?,?,\'admin\')', [security.randomId('inv'), next.inviteUrl || null, now]);
    await db.runQuery(`UPDATE commerce_settings SET access_name=?,access_description=?,price_cents=?,sales_status=?,invite_url=?,support_phone=?,destination_group_id=?,email_subject=?,email_body=?,updated_at=? WHERE id=1`,
      [next.accessName, next.accessDescription, next.priceCents, next.salesStatus, next.inviteUrl || null, next.supportPhone, next.destinationGroupId, next.emailSubject, next.emailBody, now]);
    res.json({ ok: true, partial: Object.keys(fieldErrors).length > 0, fieldErrors,
      message: Object.keys(fieldErrors).length ? 'Os dados válidos foram salvos. Confira os campos destacados.' : 'Configurações salvas.' });
  });
  app.get('/api/admin/invite-history', security.requireAdmin, async (_req, res) => res.json(await db.getQuery('SELECT * FROM invite_history ORDER BY changed_at DESC LIMIT 50')));

  app.post('/api/admin/offers', security.requireAdmin, async (req, res) => {
    const name = cleanText(req.body.exactName, 220), cents = Number(req.body.priceCents);
    if (name.length < 3 || !Number.isInteger(cents) || cents < 1) return res.status(422).json({ error: 'Informe nome exato e preço válido.' });
    const id = security.randomId('off'), now = new Date().toISOString();
    await db.runQuery('INSERT INTO store_offers(id,exact_name,price_cents,status,created_at,updated_at) VALUES (?,?,?,\'researching\',?,?)', [id, name, cents, now, now]);
    processOffer(id).catch(() => {});
    res.status(202).json({ id, status: 'researching' });
  });

  app.post('/api/admin/offers/:id/photo', security.requireAdmin, upload.single('photo'), async (req, res) => {
    if (!req.file) return res.status(422).json({ error: 'Envie JPG, PNG ou WebP de até 8 MB.' });
    const [offer] = await db.getQuery('SELECT * FROM store_offers WHERE id=?', [req.params.id]);
    if (!offer) return res.status(404).json({ error: 'Oferta não encontrada.' });
    await db.runQuery("UPDATE store_offers SET real_image_path=?,selected_image_url=NULL,image_is_illustrative=0,status='researching',failure_reason=NULL,updated_at=? WHERE id=?", [req.file.path, new Date().toISOString(), req.params.id]);
    try {
      const analysis = await analyzeRealPhoto(offer, req.file.path);
      if (analysis.configurationPending) {
        await db.runQuery("UPDATE store_offers SET status='configuration_pending',failure_reason=?,updated_at=? WHERE id=?", [analysis.reason, new Date().toISOString(), req.params.id]);
        return res.status(202).json({ ok: true, status: 'configuration_pending' });
      }
      if (analysis.blocked) {
        await db.runQuery("UPDATE store_offers SET status='needs_real_photo',failure_reason=?,research_json=?,updated_at=? WHERE id=?", [analysis.reason, JSON.stringify(analysis.raw || {}), new Date().toISOString(), req.params.id]);
        return res.status(422).json({ error: analysis.reason, status: 'needs_real_photo' });
      }
      const result = analysis.result;
      await db.runQuery("UPDATE store_offers SET model_identified=?,confidence=?,caption=?,research_json=?,status='ready',failure_reason=NULL,updated_at=? WHERE id=?", [result.model, Number(result.confidence), result.caption, JSON.stringify({ provider: 'nvidia', vision: result }), new Date().toISOString(), req.params.id]);
      publishOffer(req.params.id).catch(() => {});
      return res.status(202).json({ ok: true, status: 'ready' });
    } catch (error) {
      await db.runQuery("UPDATE store_offers SET status='failed',failure_reason=?,updated_at=? WHERE id=?", [String(error.message).slice(0, 300), new Date().toISOString(), req.params.id]);
      return res.status(502).json({ error: 'A validação da imagem pela NVIDIA falhou. Tente novamente.' });
    }
  });
  app.post('/api/admin/offers/:id/publish', security.requireAdmin, async (req, res) => res.json({ sent: await publishOffer(req.params.id) }));
}

module.exports = { registerCommerceRoutes, approveOrderFromProvider, buildOffersCsv };
