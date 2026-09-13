import { decryptJson } from './_shared/crypto.mjs';
import { listJson } from './_shared/blob.mjs';
import { relay, upstream } from './_shared/upstream.mjs';

const publicOrder = (order, dataKey) => {
  const customer = decryptJson(order.customer, dataKey);
  return {
    id: order.id, amount_cents: order.amountCents, currency: order.currency, status: order.status,
    provider_status: `confirmed_${order.plan}`, approved_at: order.approvedAt, redeem_expires_at: null,
    created_at: order.createdAt, name: customer.name, email: customer.email, cpf_mask: order.cpfMask,
    phone: customer.phone, email_status: null, email_attempts: 0, email_error: null,
    plan_key: order.plan, has_redeem: false, purchase_source: 'lastlink',
  };
};

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).send('Method not allowed');
  const source = await upstream(request, '/api/admin/overview');
  if (!source.ok) return relay(source, response);
  const overview = await source.json();
  const dataKey = process.env.LASTLINK_DATA_KEY;
  if (!dataKey) return response.status(200).setHeader('Cache-Control', 'no-store').json(overview);
  const recent = (await listJson('orders/')).map(order => publicOrder(order, dataKey)).sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
  const existingIds = new Set((overview.buyers || []).map(order => order.id));
  overview.buyers = [...recent.filter(order => !existingIds.has(order.id)), ...(overview.buyers || [])].sort((left, right) => new Date(right.created_at) - new Date(left.created_at)).slice(0, 500);
  overview.capabilities = { adminRealtime: false, orderEmailRecovery: false, vercelLastlink: true };
  overview.diagnostics = {
    latestWebhook: recent[0] ? { status: 'Compra recebida', reason: recent[0].plan_key === 'clube' ? 'Clube Socio' : 'VIP Garimpo', receivedAt: recent[0].created_at } : null,
    latestImport: null,
    emailWorker: { configured: Boolean(overview.integrations?.smtp), lastRunAt: null, lastOutcome: null, lastError: null },
  };
  overview.integrations = { ...(overview.integrations || {}), lastlinkWebhook: Boolean(process.env.LASTLINK_VIP_WEBHOOK_SECRET || process.env.LASTLINK_CLUBE_WEBHOOK_SECRET) };
  response.setHeader('Cache-Control', 'no-store');
  return response.status(200).json(overview);
}
