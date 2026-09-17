import { getStore } from '@netlify/blobs';
import { decryptJson } from './_shared/crypto.mjs';
import { cpfKey, maskName, normalizeCpf, paymentKey, validDocument } from './_shared/lastlink.mjs';
import { upstream, relay } from './_shared/upstream.mjs';

export default async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const rawBody = await request.text();
  const source = await upstream(request, '/api/staff/cpf-lookup', rawBody);
  if (!source.ok) return relay(source);
  const sourceResult = await source.json();
  if (sourceResult.found) return Response.json(sourceResult, { headers: { 'Cache-Control': 'no-store' } });

  let body;
  try { body = JSON.parse(rawBody); } catch { return Response.json({ error: 'JSON invalido.' }, { status: 400 }); }
  const document = normalizeCpf(body.document || body.cpf);
  if (!validDocument(document)) return Response.json({ error: 'Informe um CPF ou CNPJ valido.' }, { status: 422 });

  const dataKey = Netlify.env.get('LASTLINK_DATA_KEY');
  if (!dataKey) return Response.json({ found: false }, { headers: { 'Cache-Control': 'no-store' } });
  const store = getStore({ name: 'lastlink-purchases', consistency: 'strong' });
  const index = await store.get(cpfKey(document, dataKey), { type: 'json' });
  if (!index?.paymentId) return Response.json({ found: false }, { headers: { 'Cache-Control': 'no-store' } });
  const order = await store.get(paymentKey(index.paymentId), { type: 'json' });
  if (!order) return Response.json({ found: false }, { headers: { 'Cache-Control': 'no-store' } });

  const customer = decryptJson(order.customer, dataKey);
  const purchasedAt = new Date(order.approvedAt || order.createdAt);
  const validUntil = new Date(purchasedAt);
  validUntil.setFullYear(validUntil.getFullYear() + 1);
  return Response.json({
    found: true,
    customer: maskName(customer.name),
    documentType: document.length === 14 ? 'CNPJ' : 'CPF',
    documentLastFive: document.slice(-5),
    cpfLastFive: document.slice(-5),
    plan: order.plan === 'clube' ? 'Clube Socio' : 'VIP Garimpo',
    status: order.status === 'approved' && validUntil > new Date() ? 'ativo' : 'inativo',
    purchasedAt: purchasedAt.toISOString(),
    validUntil: validUntil.toISOString(),
    invitePageExpiresAt: null,
  }, { headers: { 'Cache-Control': 'no-store' } });
};
