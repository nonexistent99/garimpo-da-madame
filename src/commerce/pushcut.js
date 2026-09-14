function formatAmount(amountCents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(Number(amountCents || 0) / 100);
}

function planLabel(plan) {
  return String(plan || '').toLowerCase().includes('clube') ? 'Clube Sócio' : 'VIP Garimpo';
}

/**
 * Sends a minimal, non-sensitive sale notification to Pushcut.
 * The URL is intentionally supplied only through the environment.
 * A notification failure must never fail or roll back an approved order.
 */
async function notifyApprovedSale({ plan, amountCents, source = 'lastlink' } = {}) {
  const endpoint = String(process.env.PUSHCUT_WEBHOOK_URL || '').trim();
  if (!endpoint) return { sent: false, configured: false };

  const body = {
    title: 'Nova venda aprovada',
    text: `${planLabel(plan)} • ${formatAmount(amountCents)}`,
    input: { plan: planLabel(plan), amount: formatAmount(amountCents), source },
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { sent: false, configured: true, status: response.status };
    return { sent: true, configured: true };
  } catch (error) {
    return { sent: false, configured: true, error: String(error?.message || error).slice(0, 180) };
  }
}

module.exports = { notifyApprovedSale };
