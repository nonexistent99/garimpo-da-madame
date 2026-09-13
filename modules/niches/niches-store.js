const db = require('../../src/database/database');
const { createId, nowIso, firstRow, publicRecord } = require('../common');

async function listNiches() {
  await db.ready;
  const rows = await db.getQuery('SELECT * FROM niches ORDER BY name ASC');
  return rows.map(publicRecord);
}

async function getNicheBySlug(slug) {
  await db.ready;
  const row = firstRow(await db.getQuery('SELECT * FROM niches WHERE slug = ? OR id = ?', [slug, slug]));
  return publicRecord(row);
}

async function getNicheById(id) {
  await db.ready;
  const row = firstRow(await db.getQuery('SELECT * FROM niches WHERE id = ?', [id]));
  return publicRecord(row);
}

async function createNiche(input = {}) {
  await db.ready;
  const now = nowIso();
  const id = input.id || createId('niche');
  const slug = String(input.slug || id).trim();
  if (!input.name || !slug) throw new Error('name e slug sao obrigatorios');

  await db.runQuery(
    `INSERT INTO niches (
      id, name, slug, description, target_audience, allowed_product_types, tone, default_cta, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      String(input.name).trim(),
      slug,
      input.description || null,
      input.target_audience || null,
      input.allowed_product_types || null,
      input.tone || null,
      input.default_cta || null,
      now,
      now,
    ]
  );
  return getNicheById(id);
}

async function updateNiche(id, input = {}) {
  await db.ready;
  const current = await getNicheById(id);
  if (!current) return null;
  const next = { ...current, ...input };
  await db.runQuery(
    `UPDATE niches SET
      name = ?, slug = ?, description = ?, target_audience = ?, allowed_product_types = ?,
      tone = ?, default_cta = ?, updated_at = ?
    WHERE id = ?`,
    [
      next.name,
      next.slug,
      next.description || null,
      next.target_audience || null,
      next.allowed_product_types || null,
      next.tone || null,
      next.default_cta || null,
      nowIso(),
      id,
    ]
  );
  return getNicheById(id);
}

async function deleteNiche(id) {
  await db.ready;
  await db.runQuery('DELETE FROM niches WHERE id = ?', [id]);
  return true;
}

module.exports = {
  listNiches,
  getNicheBySlug,
  getNicheById,
  createNiche,
  updateNiche,
  deleteNiche,
};
