const crypto = require('crypto');

function read(object, ...keys) {
  for (const key of keys) if (object && object[key] !== undefined) return object[key];
  return undefined;
}

function safeEqual(value, expected) {
  if (!value || !expected) return false;
  const a = Buffer.from(String(value));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function webhookSecret(req) {
  return req.headers['x-lastlink-secret'] || req.query.secret || '';
}

function webhookPlan(secret) {
  if (safeEqual(secret, process.env.LASTLINK_VIP_WEBHOOK_SECRET)) return 'vip';
  if (safeEqual(secret, process.env.LASTLINK_CLUBE_WEBHOOK_SECRET)) return 'clube';
  if (safeEqual(secret, process.env.LASTLINK_WEBHOOK_SECRET)) return 'standard';
  return null;
}

function extract(payload) {
  const data = read(payload, 'Data', 'data') || {};
  const buyer = read(data, 'Buyer', 'buyer') || {};
  const purchase = read(data, 'Purchase', 'purchase') || {};
  const offer = read(data, 'Offer', 'offer') || {};
  const products = read(data, 'Products', 'products') || [];
  const price = read(read(purchase, 'Price', 'price') || {}, 'Value', 'value');
  return {
    eventId: String(read(payload, 'Id', 'id') || ''),
    event: String(read(payload, 'Event', 'event') || ''),
    isTest: read(payload, 'IsTest', 'isTest') === true,
    createdAt: read(payload, 'CreatedAt', 'createdAt'),
    buyer: {
      name: read(buyer, 'Name', 'name'), email: read(buyer, 'Email', 'email'),
      phone: read(buyer, 'PhoneNumber', 'phoneNumber'), document: read(buyer, 'Document', 'document'),
    },
    paymentId: String(read(purchase, 'PaymentId', 'paymentId') || ''),
    amountCents: Number.isFinite(Number(price)) ? Math.round(Number(price) * 100) : null,
    currency: 'BRL',
    paymentMethod: read(read(purchase, 'Payment', 'payment') || {}, 'PaymentMethod', 'paymentMethod'),
    offerId: String(read(offer, 'Id', 'id') || ''),
    offerUrl: read(offer, 'Url', 'url'),
    productIds: Array.isArray(products) ? products.map(product => String(read(product, 'Id', 'id') || '')).filter(Boolean) : [],
  };
}

function verifyPurchase(event, settings, plan = 'standard') {
  if (event.event !== 'Purchase_Order_Confirmed') return { ok: false, reason: 'event_not_supported' };
  if (!event.eventId || !event.paymentId) return { ok: false, reason: 'missing_identifiers' };
  const prefix = plan === 'vip' ? 'LASTLINK_VIP' : plan === 'clube' ? 'LASTLINK_CLUBE' : 'LASTLINK';
  const expectedOffer = String(process.env[`${prefix}_OFFER_ID`] || '');
  const expectedProduct = String(process.env[`${prefix}_PRODUCT_ID`] || '');
  const configuredAmount = Number(process.env[`${prefix}_AMOUNT_CENTS`]);
  const expectedAmount = Number.isInteger(configuredAmount) && configuredAmount > 0
    ? configuredAmount
    : plan === 'vip' ? 9700 : plan === 'clube' ? 49700 : Number(settings.price_cents);
  if (expectedOffer && event.offerId !== expectedOffer) return { ok: false, reason: 'offer_mismatch' };
  if (expectedProduct && !event.productIds.includes(expectedProduct)) return { ok: false, reason: 'product_mismatch' };
  if (plan === 'standard' && !expectedOffer && !expectedProduct) return { ok: false, reason: 'product_not_configured' };
  if (!Number.isInteger(event.amountCents) || event.amountCents !== expectedAmount) return { ok: false, reason: 'amount_mismatch' };
  return { ok: true, plan };
}

function checkoutConfigured() {
  try {
    const url = new URL(process.env.LASTLINK_VIP_CHECKOUT_URL || process.env.LASTLINK_CHECKOUT_URL || '');
    return url.protocol === 'https:' && /(^|\.)lastlink\.com$/i.test(url.hostname)
      && !!(process.env.LASTLINK_VIP_WEBHOOK_SECRET || process.env.LASTLINK_WEBHOOK_SECRET);
  } catch { return false; }
}

module.exports = { safeEqual, webhookSecret, webhookPlan, extract, verifyPurchase, checkoutConfigured };
