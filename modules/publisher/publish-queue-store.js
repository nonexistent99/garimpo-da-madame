const db = require('../../src/database/database');
const { createId, nowIso, firstRow, publicRecord } = require('../common');

async function createQueueItem(input) {
  await db.ready;
  const id = createId('pq');
  const now = nowIso();
  await db.runQuery(
    `INSERT INTO publish_queue (
      id, creative_id, product_id, account_id, scheduled_at, caption, status,
      error_message, quality_review_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.creative_id,
      input.product_id || null,
      input.account_id,
      input.scheduled_at || null,
      input.caption || null,
      input.status || 'waiting_approval',
      input.error_message || null,
      input.quality_review_id || null,
      now,
      now,
    ]
  );
  return getQueueItem(id);
}

async function listQueue(filters = {}) {
  await db.ready;
  const where = [];
  const params = [];
  if (filters.status) {
    where.push('q.status = ?');
    params.push(filters.status);
  }
  if (filters.account_id) {
    where.push('q.account_id = ?');
    params.push(filters.account_id);
  }
  if (filters.platform) {
    where.push('a.platform = ?');
    params.push(filters.platform);
  }
  if (filters.date) {
    where.push('date(q.scheduled_at) = date(?)');
    params.push(filters.date);
  }

  const rows = await db.getQuery(
    `SELECT q.*, a.platform, a.handle, c.hook, c.video_path, p.name AS product_name
     FROM publish_queue q
     LEFT JOIN social_accounts a ON a.id = q.account_id
     LEFT JOIN creative_variants c ON c.id = q.creative_id
     LEFT JOIN products p ON p.id = q.product_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY q.created_at DESC`,
    params
  );
  return rows.map(publicRecord);
}

async function getQueueItem(id) {
  await db.ready;
  const row = firstRow(await db.getQuery('SELECT * FROM publish_queue WHERE id = ?', [id]));
  return publicRecord(row);
}

async function updateQueueItem(id, fields = {}) {
  await db.ready;
  const current = await getQueueItem(id);
  if (!current) return null;
  const next = { ...current, ...fields };
  await db.runQuery(
    `UPDATE publish_queue SET
      scheduled_at = ?, caption = ?, status = ?, error_message = ?, quality_review_id = ?, updated_at = ?
    WHERE id = ?`,
    [
      next.scheduled_at || null,
      next.caption || null,
      next.status || 'draft',
      next.error_message || null,
      next.quality_review_id || null,
      nowIso(),
      id,
    ]
  );
  return getQueueItem(id);
}

module.exports = {
  createQueueItem,
  listQueue,
  getQueueItem,
  updateQueueItem,
};
