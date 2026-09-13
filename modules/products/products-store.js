const db = require('../../src/database/database');
const { createId, nowIso, jsonString, safeJsonParse, toNumber, publicRecord, firstRow } = require('../common');

function calculateDiscountPct(oldPrice, currentPrice) {
  const oldValue = toNumber(oldPrice);
  const currentValue = toNumber(currentPrice);
  if (!oldValue || !currentValue || oldValue <= currentValue) return 0;
  return Math.round(((oldValue - currentValue) / oldValue) * 10000) / 100;
}

function calculateScore(product) {
  const discountComponent = Math.max(0, Math.min(100, toNumber(product.discount_pct, 0)));
  const nicheFit = product.niche ? 70 : 50;
  const currentPrice = toNumber(product.current_price, 0);
  let impulsePrice = 45;
  if (currentPrice <= 50) impulsePrice = 90;
  else if (currentPrice <= 100) impulsePrice = 85;
  else if (currentPrice <= 200) impulsePrice = 75;
  else if (currentPrice <= 500) impulsePrice = 60;

  const imageQuality = product.image_url ? 70 : 40;
  const historicalPerformance = 50;

  return Math.round((
    discountComponent * 0.45 +
    nicheFit * 0.20 +
    impulsePrice * 0.15 +
    imageQuality * 0.10 +
    historicalPerformance * 0.10
  ) * 100) / 100;
}

function normalizeProductInput(input = {}) {
  const oldPrice = toNumber(input.old_price ?? input.oldPrice);
  const currentPrice = toNumber(input.current_price ?? input.currentPrice);
  const discountPct = toNumber(input.discount_pct ?? input.discount);
  const computedDiscount = discountPct == null ? calculateDiscountPct(oldPrice, currentPrice) : discountPct;

  return {
    name: String(input.name || '').trim(),
    niche: String(input.niche || input.category || '').trim() || null,
    old_price: oldPrice,
    current_price: currentPrice,
    discount_pct: computedDiscount,
    image_url: String(input.image_url || input.image || '').trim() || null,
    affiliate_url: String(input.affiliate_url || input.affiliateLink || '').trim() || null,
    source: String(input.source || 'manual').trim(),
    metadata: input.metadata || input.metadata_json || {},
  };
}

async function createProduct(input) {
  await db.ready;
  const product = normalizeProductInput(input);
  if (!product.name) throw new Error('name e obrigatorio');
  if (!product.current_price || product.current_price <= 0) throw new Error('current_price e obrigatorio');

  product.score = calculateScore(product);
  const id = createId('prod');
  const now = nowIso();

  await db.runQuery(
    `INSERT INTO products (
      id, name, niche, old_price, current_price, discount_pct, image_url, affiliate_url, source,
      score, status, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      product.name,
      product.niche,
      product.old_price,
      product.current_price,
      product.discount_pct,
      product.image_url,
      product.affiliate_url,
      product.source,
      product.score,
      'new',
      jsonString(product.metadata || {}),
      now,
      now,
    ]
  );

  return getProduct(id);
}

async function listProducts(filters = {}) {
  await db.ready;
  const where = [];
  const params = [];

  if (filters.niche) {
    where.push('niche = ?');
    params.push(filters.niche);
  }
  if (filters.status) {
    where.push('status = ?');
    params.push(filters.status);
  }
  if (filters.min_score != null) {
    where.push('score >= ?');
    params.push(Number(filters.min_score));
  }

  const sortMap = {
    score: 'score DESC',
    discount: 'discount_pct DESC',
    date: 'created_at DESC',
    created_at: 'created_at DESC',
  };
  const orderBy = sortMap[filters.sort] || 'created_at DESC';
  const limit = Math.max(1, Math.min(200, parseInt(filters.limit || '50', 10) || 50));

  const rows = await db.getQuery(
    `SELECT * FROM products ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${orderBy} LIMIT ?`,
    [...params, limit]
  );
  return rows.map(publicRecord);
}

async function getTopProducts(filters = {}) {
  return listProducts({ ...filters, sort: 'score', limit: filters.limit || 10 });
}

async function getProduct(id) {
  await db.ready;
  const row = firstRow(await db.getQuery('SELECT * FROM products WHERE id = ?', [id]));
  return publicRecord(row);
}

async function updateProductStatus(id, status) {
  await db.ready;
  const allowed = new Set(['new', 'approved', 'rejected', 'campaign_generated', 'expired']);
  if (!allowed.has(status)) throw new Error('status invalido');
  await db.runQuery('UPDATE products SET status = ?, updated_at = ? WHERE id = ?', [status, nowIso(), id]);
  return getProduct(id);
}

async function updateProduct(id, fields = {}) {
  await db.ready;
  const current = await getProduct(id);
  if (!current) return null;
  const merged = { ...current, ...normalizeProductInput({ ...current, ...fields }) };
  merged.discount_pct = fields.discount_pct == null ? calculateDiscountPct(merged.old_price, merged.current_price) : merged.discount_pct;
  merged.score = calculateScore(merged);
  await db.runQuery(
    `UPDATE products SET
      name = ?, niche = ?, old_price = ?, current_price = ?, discount_pct = ?, image_url = ?,
      affiliate_url = ?, source = ?, score = ?, metadata_json = ?, updated_at = ?
    WHERE id = ?`,
    [
      merged.name,
      merged.niche,
      merged.old_price,
      merged.current_price,
      merged.discount_pct,
      merged.image_url,
      merged.affiliate_url,
      merged.source,
      merged.score,
      jsonString(merged.metadata || safeJsonParse(merged.metadata_json, {})),
      nowIso(),
      id,
    ]
  );
  return getProduct(id);
}

module.exports = {
  calculateDiscountPct,
  calculateScore,
  createProduct,
  listProducts,
  getTopProducts,
  getProduct,
  updateProduct,
  updateProductStatus,
};
