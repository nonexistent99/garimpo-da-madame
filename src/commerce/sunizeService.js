const API_BASE = 'https://api.sunize.com.br/v2';

function configured() {
  return Boolean(process.env.SUNIZE_API_KEY && process.env.SUNIZE_API_SECRET);
}

function headers() {
  if (!configured()) throw Object.assign(new Error('Sunize ainda não configurada.'), { code: 'SUNIZE_NOT_CONFIGURED' });
  return {
    'Content-Type': 'application/json',
    'x-api-key': process.env.SUNIZE_API_KEY,
    'x-api-secret': process.env.SUNIZE_API_SECRET,
  };
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.hasError) {
      const message = data.message || data.error || 'A Sunize não conseguiu criar o pagamento.';
      throw Object.assign(new Error(message), { code: 'SUNIZE_API_ERROR', status: response.status });
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('A Sunize demorou para responder. Tente novamente.'), { code: 'SUNIZE_TIMEOUT' });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function planConfig(plan) {
  if (plan === 'clube') {
    return {
      id: 'clube-socio-kwai',
      title: 'Clube Sócio Garimpo',
      description: 'Participação anual para CNPJ, lojistas e revendedores.',
      amountCents: Number(process.env.SUNIZE_CLUBE_AMOUNT_CENTS) || 49_700,
    };
  }
  return {
    id: 'vip-garimpo-kwai',
    title: 'VIP Garimpo',
    description: 'Participação anual no VIP Garimpo.',
    amountCents: Number(process.env.SUNIZE_VIP_AMOUNT_CENTS) || 9_700,
  };
}

async function createTransaction({ orderId, plan, customer, tracking, ip }) {
  const product = planConfig(plan);
  const amount = product.amountCents / 100;
  const data = await request('/transactions', {
    method: 'POST',
    body: JSON.stringify({
      external_id: orderId,
      amount,
      payment_method: 'PIX',
      items: [{
        id: product.id,
        title: product.title,
        description: product.description,
        price: amount,
        quantity: 1,
        is_physical: false,
      }],
      ip,
      customer: {
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        document_type: customer.document.length === 14 ? 'CNPJ' : 'CPF',
        document: customer.document,
      },
      tracking,
    }),
  });
  const pixCode = data.pix?.payload || data.pix?.qr_code || '';
  if (!data.id || !pixCode) throw Object.assign(new Error('A Sunize não retornou o código PIX.'), { code: 'SUNIZE_INVALID_RESPONSE' });
  return { id: String(data.id), status: String(data.status || 'PENDING'), pixCode, amountCents: product.amountCents };
}

async function getTransaction(id) {
  return request(`/transactions/${encodeURIComponent(id)}`);
}

function webhookAuthorized(req) {
  const received = String(req.headers['x-api-secret'] || '');
  const expected = String(process.env.SUNIZE_API_SECRET || '');
  if (!received || !expected || received.length !== expected.length) return false;
  return require('crypto').timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

module.exports = { configured, planConfig, createTransaction, getTransaction, webhookAuthorized };
