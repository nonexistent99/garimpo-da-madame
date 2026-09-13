import { getStore } from '@netlify/blobs';
import { encryptJson, hmacHex, safeEqual } from './_shared/crypto.mjs';
import { cpfKey, eventKey, extractLastlink, maskCpf, paymentKey, safeDate, validatePurchase } from './_shared/lastlink.mjs';
import { relay, upstream } from './_shared/upstream.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

const authenticate = (request, rawBody) => {
  const url = new URL(request.url);
  const requestedPlan = url.searchParams.get('plan');
  const legacySecret = url.searchParams.get('secret') || '';
  let signature = request.headers.get('x-lastlink-signature')
    || request.headers.get('x-lastlink-token')
    || request.headers.get('x-hub-signature-256')
    || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || '';
  if (signature.startsWith('sha256=')) signature = signature.slice(7);
  const candidates = [
    ['vip', Netlify.env.get('LASTLINK_VIP_WEBHOOK_SECRET')],
    ['clube', Netlify.env.get('LASTLINK_CLUBE_WEBHOOK_SECRET')],
  ].filter(([plan, secret]) => secret && (!requestedPlan || requestedPlan === plan));
  for (const [plan, secret] of candidates) {
    if (safeEqual(legacySecret, secret) || safeEqual(signature, secret) || safeEqual(signature, hmacHex(rawBody, secret))) return plan;
  }
  return null;
};

export default async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Metodo nao permitido.' }, 405);
  const rawBody = await request.text();
  const plan = authenticate(request, rawBody);
  if (!plan) {
    // Durante a transição, as credenciais podem estar apenas no Railway. Repassar
    // o evento preserva a validação do backend sem aceitar nada localmente.
    const url = new URL(request.url);
    return relay(await upstream(request, `/api/webhooks/lastlink${url.search}`, rawBody));
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return json({ error: 'JSON invalido.' }, 400); }
  const event = extractLastlink(payload);
  if (event.isTest) return json({ ok: true, test: true, plan, storage: Boolean(Netlify.env.get('LASTLINK_DATA_KEY')) });

  const supportedEvents = new Set(['Purchase_Order_Confirmed', 'Payment_Refund', 'Payment_Chargeback']);
  if (!supportedEvents.has(event.event)) return json({ ok: true, ignored: true, event: event.event });

  const store = getStore({ name: 'lastlink-purchases', consistency: 'strong' });

  if (event.event === 'Payment_Refund' || event.event === 'Payment_Chargeback') {
    if (!event.eventId || !event.paymentId) return json({ error: 'Evento sem identificador.' }, 422);
    const key = paymentKey(event.paymentId);
    const existing = await store.get(key, { type: 'json' });
    if (existing) {
      await store.setJSON(key, {
        ...existing,
        status: event.event === 'Payment_Refund' ? 'refunded' : 'chargeback',
        updatedAt: new Date().toISOString(),
      });
    }
    await store.setJSON(eventKey(event.eventId), { processedAt: new Date().toISOString(), event: event.event });
    return json({ ok: true, revoked: Boolean(existing) });
  }

  const dataKey = Netlify.env.get('LASTLINK_DATA_KEY');
  if (!dataKey) return json({ error: 'Armazenamento nao configurado.' }, 503);
  const validationError = validatePurchase(event);
  if (validationError) return json({ error: validationError }, 422);
  if (await store.get(eventKey(event.eventId), { type: 'json' })) return json({ ok: true, replay: true });

  const approvedAt = safeDate(event.createdAt);
  const order = {
    schema: 1,
    id: `nfl_${paymentKey(event.paymentId).slice(7, 31)}`,
    paymentId: event.paymentId,
    plan,
    status: 'approved',
    amountCents: event.amountCents,
    currency: 'BRL',
    paymentMethod: event.paymentMethod,
    offerId: event.offerId,
    productIds: event.productIds,
    cpfHash: cpfKey(event.buyer.cpf, dataKey).slice(4),
    cpfMask: maskCpf(event.buyer.cpf),
    customer: encryptJson({ name: event.buyer.name, email: event.buyer.email, phone: event.buyer.phone }, dataKey),
    approvedAt,
    createdAt: approvedAt,
    updatedAt: new Date().toISOString(),
  };
  await store.setJSON(paymentKey(event.paymentId), order);
  await store.setJSON(cpfKey(event.buyer.cpf, dataKey), { paymentId: event.paymentId, updatedAt: order.updatedAt });
  await store.setJSON(eventKey(event.eventId), { processedAt: order.updatedAt, paymentId: event.paymentId, plan });

  console.info(JSON.stringify({ type: 'lastlink.purchase.stored', orderId: order.id, plan }));
  return json({ ok: true, orderId: order.id });
};
