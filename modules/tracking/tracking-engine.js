const db = require('../../src/database/database');
const { createId, nowIso, jsonString, firstRow } = require('../common');

function createTrackingCode({ product, creative, account }) {
  const productPart = product && product.id ? product.id.slice(-6) : 'prod';
  const creativePart = creative && creative.id ? creative.id.slice(-6) : 'cre';
  const accountPart = account && account.id ? account.id.slice(-6) : 'acct';
  return `${productPart}_${creativePart}_${accountPart}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildTrackingUrl(trackingCode) {
  const base = (process.env.BASE_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  return `${base}/r/${encodeURIComponent(trackingCode)}`;
}

async function registerEvent({ trackingCode, eventType = 'click', source = null, accountId = null, productId = null, creativeId = null, metadata = {} }) {
  await db.ready;
  const id = createId('trk');
  await db.runQuery(
    `INSERT INTO tracking_events (
      id, tracking_code, event_type, source, account_id, product_id, creative_id, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, trackingCode, eventType, source, accountId, productId, creativeId, jsonString(metadata || {}), nowIso()]
  );
  return { id, tracking_code: trackingCode, event_type: eventType };
}

async function resolveRedirectTarget(trackingCode) {
  await db.ready;
  const row = firstRow(await db.getQuery(
    `SELECT pp.*, p.affiliate_url
     FROM published_posts pp
     LEFT JOIN products p ON p.id = pp.product_id
     WHERE pp.tracking_code = ?
     ORDER BY pp.created_at DESC
     LIMIT 1`,
    [trackingCode]
  ));
  if (!row) return null;
  return {
    targetUrl: row.affiliate_url || null,
    account_id: row.account_id,
    product_id: row.product_id,
    creative_id: row.creative_id,
  };
}

async function createPublishedPost(input) {
  await db.ready;
  const id = createId('post');
  const now = nowIso();
  await db.runQuery(
    `INSERT INTO published_posts (
      id, creative_id, product_id, account_id, platform, platform_post_id, public_url,
      tracking_code, status, published_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.creative_id || null,
      input.product_id || null,
      input.account_id || null,
      input.platform || null,
      input.platform_post_id || null,
      input.public_url || null,
      input.tracking_code || null,
      input.status || 'published',
      input.published_at || now,
      now,
    ]
  );
  return id;
}

module.exports = {
  createTrackingCode,
  buildTrackingUrl,
  registerEvent,
  resolveRedirectTarget,
  createPublishedPost,
};
