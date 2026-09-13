const db = require('../../src/database/database');
const { createId, nowIso, jsonString, safeJsonParse, firstRow, publicRecord } = require('../common');

function normalizeCreative(row) {
  const record = publicRecord(row);
  if (!record) return null;
  record.on_screen_text = safeJsonParse(record.on_screen_text_json, []);
  record.hashtags = safeJsonParse(record.hashtags_json, []);
  delete record.on_screen_text_json;
  delete record.hashtags_json;
  return record;
}

async function createCreative(input) {
  await db.ready;
  const id = input.id || createId('cre');
  const now = nowIso();
  await db.runQuery(
    `INSERT INTO creative_variants (
      id, product_id, campaign_id, angle, hook, script, on_screen_text_json, caption,
      hashtags_json, cta, video_path, audio_path, status, quality_status, quality_score,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.product_id,
      input.campaign_id || null,
      input.angle || null,
      input.hook || null,
      input.script || null,
      jsonString(input.on_screen_text || []),
      input.caption || null,
      jsonString(input.hashtags || []),
      input.cta || null,
      input.video_path || null,
      input.audio_path || null,
      input.status || 'draft',
      input.quality_status || null,
      input.quality_score || null,
      now,
      now,
    ]
  );
  return getCreative(id);
}

async function listCreatives(filters = {}) {
  await db.ready;
  const where = [];
  const params = [];
  if (filters.product_id) {
    where.push('product_id = ?');
    params.push(filters.product_id);
  }
  if (filters.status) {
    where.push('status = ?');
    params.push(filters.status);
  }
  const rows = await db.getQuery(
    `SELECT * FROM creative_variants ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`,
    params
  );
  return rows.map(normalizeCreative);
}

async function getCreative(id) {
  await db.ready;
  return normalizeCreative(firstRow(await db.getQuery('SELECT * FROM creative_variants WHERE id = ?', [id])));
}

async function updateCreative(id, fields = {}) {
  await db.ready;
  const current = await getCreative(id);
  if (!current) return null;
  const next = { ...current, ...fields };
  await db.runQuery(
    `UPDATE creative_variants SET
      campaign_id = ?, angle = ?, hook = ?, script = ?, on_screen_text_json = ?, caption = ?,
      hashtags_json = ?, cta = ?, video_path = ?, audio_path = ?, status = ?, quality_status = ?,
      quality_score = ?, updated_at = ?
    WHERE id = ?`,
    [
      next.campaign_id || null,
      next.angle || null,
      next.hook || null,
      next.script || null,
      jsonString(next.on_screen_text || []),
      next.caption || null,
      jsonString(next.hashtags || []),
      next.cta || null,
      next.video_path || null,
      next.audio_path || null,
      next.status || 'draft',
      next.quality_status || null,
      next.quality_score == null ? null : Number(next.quality_score),
      nowIso(),
      id,
    ]
  );
  return getCreative(id);
}

async function setCreativeStatus(id, status, extra = {}) {
  return updateCreative(id, { ...extra, status });
}

module.exports = {
  createCreative,
  listCreatives,
  getCreative,
  updateCreative,
  setCreativeStatus,
};
