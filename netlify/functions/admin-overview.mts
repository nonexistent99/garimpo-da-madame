import { getStore } from '@netlify/blobs';
import { decryptJson } from './_shared/crypto.mjs';
import { upstream, relay } from './_shared/upstream.mjs';

const publicOrder = (order, dataKey) => {
  const customer = decryptJson(order.customer, dataKey);
  return {
    id: order.id,
    amount_cents: order.amountCents,
    currency: order.currency,
    status: order.status,
    provider_status: `confirmed_${order.plan}`,
    approved_at: order.approvedAt,
    redeem_expires_at: null,
    created_at: order.createdAt,
    name: customer.name,
    email: customer.email,
    cpf_mask: order.cpfMask,
    phone: customer.phone,
    email_status: null,
    email_attempts: 0,
    email_error: null,
    plan_key: order.plan,
    has_redeem: false,
    purchase_source: 'lastlink',
  };
};

export default async (request: Request) => {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const source = await upstream(request, '/api/admin/overview');
  if (!source.ok) return relay(source);

  const overview = await source.json();
  const dataKey = Netlify.env.get('LASTLINK_DATA_KEY');
  if (!dataKey) return Response.json(overview, { headers: { 'Cache-Control': 'no-store' } });
  const store = getStore({ name: 'lastlink-purchases', consistency: 'strong' });
  const { blobs } = await store.list({ prefix: 'orders/' });
  const stored = (await Promise.all(blobs.slice(0, 500).map(blob => store.get(blob.key, { type: 'json' })))).filter(Boolean);
  const recent = stored
    .map(order => publicOrder(order, dataKey))
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
  const existingIds = new Set((overview.buyers || []).map(order => order.id));
  overview.buyers = [...recent.filter(order => !existingIds.has(order.id)), ...(overview.buyers || [])]
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(0, 100);
  overview.capabilities = { adminRealtime: false, orderEmailRecovery: false, netlifyLastlink: true };
  overview.diagnostics = {
    latestWebhook: recent[0] ? { status: 'Compra recebida', reason: recent[0].plan_key === 'clube' ? 'Clube Socio' : 'VIP Garimpo', receivedAt: recent[0].created_at } : null,
    latestImport: null,
    emailWorker: { configured: Boolean(overview.integrations?.smtp), lastRunAt: null, lastOutcome: null, lastError: null },
  };
  overview.integrations = {
    ...(overview.integrations || {}),
    lastlinkWebhook: Boolean(overview.integrations?.lastlinkWebhook || Netlify.env.get('LASTLINK_VIP_WEBHOOK_SECRET') || Netlify.env.get('LASTLINK_CLUBE_WEBHOOK_SECRET')),
  };
  return Response.json(overview, { headers: { 'Cache-Control': 'no-store' } });
};
