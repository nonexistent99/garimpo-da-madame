import { encryptJson, hmacHex, safeEqual } from './_shared/crypto.mjs';
import { readJson, writeJson } from './_shared/blob.mjs';
import { cpfKey, eventKey, extractLastlink, maskCpf, paymentKey, safeDate, validatePurchase } from './_shared/lastlink.mjs';

const json = (response, value, status = 200) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
};

async function requestBody(request) {
  if (typeof request.body === 'string') return request.body;
  if (Buffer.isBuffer(request.body)) return request.body.toString('utf8');
  if (request.body && typeof request.body === 'object') return JSON.stringify(request.body);
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function authenticate(request, rawBody) {
  const url = new URL(request.url, 'https://garimpo-da-madame.vercel.app');
  const requestedPlan = url.searchParams.get('plan');
  let signature = request.headers['x-lastlink-signature'] || request.headers['x-lastlink-token'] || request.headers['x-hub-signature-256'] || request.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  if (signature.startsWith('sha256=')) signature = signature.slice(7);
  const candidates = [
    ['vip', process.env.LASTLINK_VIP_WEBHOOK_SECRET],
    ['clube', process.env.LASTLINK_CLUBE_WEBHOOK_SECRET],
  ].filter(([plan, secret]) => secret && (!requestedPlan || requestedPlan === plan));
  for (const [plan, secret] of candidates) {
    if (safeEqual(signature, secret) || safeEqual(signature, hmacHex(rawBody, secret))) return plan;
  }
  return null;
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, { error: 'Metodo nao permitido.' }, 405);
  const rawBody = await requestBody(request);
  const plan = authenticate(request, rawBody);
  if (!plan) return json(response, { error: 'Webhook nao autorizado.' }, 401);
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return json(response, { error: 'JSON invalido.' }, 400); }
  const event = extractLastlink(payload);
  if (event.isTest) return json(response, { ok: true, test: true, plan, storage: Boolean(process.env.LASTLINK_DATA_KEY) });
  if (!new Set(['Purchase_Order_Confirmed', 'Payment_Refund', 'Payment_Chargeback']).has(event.event)) return json(response, { ok: true, ignored: true, event: event.event });

  if (event.event === 'Payment_Refund' || event.event === 'Payment_Chargeback') {
    if (!event.eventId || !event.paymentId) return json(response, { error: 'Evento sem identificador.' }, 422);
    const key = paymentKey(event.paymentId);
    const existing = await readJson(key);
    if (existing) await writeJson(key, { ...existing, status: event.event === 'Payment_Refund' ? 'refunded' : 'chargeback', updatedAt: new Date().toISOString() });
    await writeJson(eventKey(event.eventId), { processedAt: new Date().toISOString(), event: event.event });
    return json(response, { ok: true, revoked: Boolean(existing) });
  }

  const dataKey = process.env.LASTLINK_DATA_KEY;
  if (!dataKey) return json(response, { error: 'Armazenamento nao configurado.' }, 503);
  const validationError = validatePurchase(event);
  if (validationError) return json(response, { error: validationError }, 422);
  if (await readJson(eventKey(event.eventId))) return json(response, { ok: true, replay: true });

  const approvedAt = safeDate(event.createdAt);
  const order = {
    schema: 1,
    id: `vcl_${paymentKey(event.paymentId).slice(7, 31)}`,
    paymentId: event.paymentId,
    plan,
    status: 'approved',
    amountCents: event.amountCents,
    currency: 'BRL',
    paymentMethod: event.paymentMethod,
    offerId: event.offerId,
    productIds: event.productIds,
    cpfMask: maskCpf(event.buyer.cpf),
    customer: encryptJson({ name: event.buyer.name, email: event.buyer.email, phone: event.buyer.phone }, dataKey),
    approvedAt,
    createdAt: approvedAt,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(paymentKey(event.paymentId), order);
  await writeJson(cpfKey(event.buyer.cpf, dataKey), { paymentId: event.paymentId, updatedAt: order.updatedAt });
  await writeJson(eventKey(event.eventId), { processedAt: order.updatedAt, paymentId: event.paymentId, plan });
  console.info(JSON.stringify({ type: 'lastlink.purchase.stored', orderId: order.id, plan }));
  return json(response, { ok: true, orderId: order.id });
}

export const config = { api: { bodyParser: false } };
