const crypto = require('crypto');

function validateWebhookSignature({ signature, requestId, dataId, secret, now = Date.now() }) {
  if (!signature || !requestId || !dataId || !secret) return false;
  const parts = Object.fromEntries(signature.split(',').map(p => p.trim().split('=', 2)));
  if (!parts.ts || !parts.v1 || !/^\d+$/.test(parts.ts)) return false;
  const tsMs = Number(parts.ts) < 1e12 ? Number(parts.ts) * 1000 : Number(parts.ts);
  if (Math.abs(now - tsMs) > 10 * 60 * 1000) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(expected); const b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function mpRequest(path, options = {}) {
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!token) throw Object.assign(new Error('Mercado Pago ainda não configurado.'), { code: 'PAYMENT_NOT_CONFIGURED' });
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Mercado Pago recusou a operação (${response.status}).`);
  return body;
}

async function createPix(order, customer) {
  const publicUrl = String(process.env.BASE_PUBLIC_URL || '').replace(/\/$/, '');
  if (!/^https:\/\//.test(publicUrl)) throw Object.assign(new Error('BASE_PUBLIC_URL HTTPS é obrigatória para o webhook real.'), { code: 'PAYMENT_NOT_CONFIGURED' });
  const names = customer.name.trim().split(/\s+/);
  const payload = {
    transaction_amount: order.amount_cents / 100,
    description: order.description,
    payment_method_id: 'pix',
    external_reference: order.id,
    notification_url: `${publicUrl}/api/webhooks/mercadopago?source_news=webhooks`,
    payer: {
      email: customer.email,
      first_name: names.shift(),
      last_name: names.join(' ') || undefined,
      identification: { type: 'CPF', number: customer.cpf },
    },
  };
  const payment = await mpRequest('/v1/payments', {
    method: 'POST', headers: { 'X-Idempotency-Key': order.id }, body: JSON.stringify(payload),
  });
  return {
    id: String(payment.id), status: payment.status,
    qrCode: payment.point_of_interaction?.transaction_data?.qr_code,
    qrBase64: payment.point_of_interaction?.transaction_data?.qr_code_base64,
  };
}

async function fetchPayment(id) { return mpRequest(`/v1/payments/${encodeURIComponent(id)}`); }

function verifyApprovedPayment(payment, order) {
  const expectedCollector = String(process.env.MERCADO_PAGO_COLLECTOR_ID || '');
  if (payment.status !== 'approved') return { ok: false, reason: 'status_not_approved' };
  if (String(payment.external_reference) !== order.id) return { ok: false, reason: 'order_mismatch' };
  if (payment.currency_id !== order.currency) return { ok: false, reason: 'currency_mismatch' };
  if (Math.round(Number(payment.transaction_amount) * 100) !== order.amount_cents) return { ok: false, reason: 'amount_mismatch' };
  if (!expectedCollector || String(payment.collector_id) !== expectedCollector) return { ok: false, reason: 'collector_mismatch' };
  return { ok: true };
}

module.exports = { validateWebhookSignature, createPix, fetchPayment, verifyApprovedPayment };
