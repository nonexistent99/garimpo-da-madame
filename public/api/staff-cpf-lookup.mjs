import { decryptJson } from './_shared/crypto.mjs';
import { readJson } from './_shared/blob.mjs';
import { cpfKey, maskName, normalizeCpf, paymentKey, validDocument } from './_shared/lastlink.mjs';
import { relay, upstream } from './_shared/upstream.mjs';

const requestBody = async request => {
  if (typeof request.body === 'string') return request.body;
  if (Buffer.isBuffer(request.body)) return request.body.toString('utf8');
  if (request.body && typeof request.body === 'object') return JSON.stringify(request.body);
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

const send = (response, value, status = 200) => {
  response.setHeader('Cache-Control', 'no-store');
  return response.status(status).json(value);
};

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).send('Method not allowed');
  const rawBody = await requestBody(request);
  const source = await upstream(request, '/api/staff/cpf-lookup', rawBody);
  if (!source.ok) return relay(source, response);
  const sourceResult = await source.json();
  if (sourceResult.found) return send(response, sourceResult);
  let body;
  try { body = JSON.parse(rawBody); } catch { return send(response, { error: 'JSON invalido.' }, 400); }
  const document = normalizeCpf(body.document || body.cpf);
  if (!validDocument(document)) return send(response, { error: 'Informe um CPF ou CNPJ valido.' }, 422);
  const dataKey = process.env.LASTLINK_DATA_KEY;
  if (!dataKey) return send(response, { found: false });
  const index = await readJson(cpfKey(document, dataKey));
  if (!index?.paymentId) return send(response, { found: false });
  const order = await readJson(paymentKey(index.paymentId));
  if (!order) return send(response, { found: false });
  const customer = decryptJson(order.customer, dataKey);
  const purchasedAt = new Date(order.approvedAt || order.createdAt);
  const validUntil = new Date(purchasedAt);
  validUntil.setFullYear(validUntil.getFullYear() + 1);
  return send(response, {
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
  });
}
