const db = require('../../src/database/database');
const { createId, nowIso, jsonString, safeJsonParse, firstRow, publicRecord } = require('../common');
const { encryptToken, maskToken } = require('../security/token-crypto');

const PLATFORMS = new Set(['tiktok', 'instagram', 'youtube', 'telegram', 'kwai', 'manual']);
const STATUSES = new Set(['warming_up', 'active', 'paused', 'needs_reauth', 'disabled']);
const POSTING_MODES = new Set(['manual', 'api', 'export_only']);

function sanitizeAccount(account) {
  if (!account) return null;
  const record = publicRecord(account);
  if (record.access_token_encrypted) record.access_token_masked = maskToken(record.access_token_encrypted);
  if (record.refresh_token_encrypted) record.refresh_token_masked = maskToken(record.refresh_token_encrypted);
  delete record.access_token_encrypted;
  delete record.refresh_token_encrypted;
  return record;
}

function normalizeInput(input = {}, existing = {}) {
  const platform = String(input.platform || existing.platform || 'manual').toLowerCase();
  const status = String(input.status || existing.status || 'active');
  const postingMode = String(input.posting_mode || existing.posting_mode || 'manual');
  if (!PLATFORMS.has(platform)) throw new Error('platform invalida');
  if (!STATUSES.has(status)) throw new Error('status invalido');
  if (!POSTING_MODES.has(postingMode)) throw new Error('posting_mode invalido');

  const metadata = input.metadata || safeJsonParse(input.metadata_json || existing.metadata_json, {});
  return {
    platform,
    handle: String(input.handle || existing.handle || '').trim(),
    niche: String(input.niche || existing.niche || '').trim() || null,
    display_name: String(input.display_name || existing.display_name || '').trim() || null,
    status,
    daily_limit: Math.max(1, parseInt(input.daily_limit ?? existing.daily_limit ?? 2, 10) || 2),
    style_prompt: input.style_prompt ?? existing.style_prompt ?? null,
    default_cta: input.default_cta ?? existing.default_cta ?? null,
    posting_mode: postingMode,
    access_token_encrypted: input.access_token ? encryptToken(input.access_token) : existing.access_token_encrypted || null,
    refresh_token_encrypted: input.refresh_token ? encryptToken(input.refresh_token) : existing.refresh_token_encrypted || null,
    token_expires_at: input.token_expires_at ?? existing.token_expires_at ?? null,
    metadata,
  };
}

async function createAccount(input) {
  await db.ready;
  const account = normalizeInput(input);
  if (!account.handle) throw new Error('handle e obrigatorio');
  const id = createId('acct');
  const now = nowIso();
  await db.runQuery(
    `INSERT INTO social_accounts (
      id, platform, handle, niche, display_name, status, daily_limit, style_prompt, default_cta,
      posting_mode, access_token_encrypted, refresh_token_encrypted, token_expires_at, metadata_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      account.platform,
      account.handle,
      account.niche,
      account.display_name,
      account.status,
      account.daily_limit,
      account.style_prompt,
      account.default_cta,
      account.posting_mode,
      account.access_token_encrypted,
      account.refresh_token_encrypted,
      account.token_expires_at,
      jsonString(account.metadata || {}),
      now,
      now,
    ]
  );
  return getAccount(id);
}

async function listAccounts(filters = {}) {
  await db.ready;
  const where = [];
  const params = [];
  if (filters.platform) {
    where.push('platform = ?');
    params.push(filters.platform);
  }
  if (filters.niche) {
    where.push('niche = ?');
    params.push(filters.niche);
  }
  const rows = await db.getQuery(
    `SELECT * FROM social_accounts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`,
    params
  );
  return rows.map(sanitizeAccount);
}

async function getAccountRaw(id) {
  await db.ready;
  return firstRow(await db.getQuery('SELECT * FROM social_accounts WHERE id = ?', [id]));
}

async function getAccount(id) {
  return sanitizeAccount(await getAccountRaw(id));
}

async function updateAccount(id, input) {
  await db.ready;
  const current = await getAccountRaw(id);
  if (!current) return null;
  const account = normalizeInput(input, current);
  await db.runQuery(
    `UPDATE social_accounts SET
      platform = ?, handle = ?, niche = ?, display_name = ?, status = ?, daily_limit = ?,
      style_prompt = ?, default_cta = ?, posting_mode = ?, access_token_encrypted = ?,
      refresh_token_encrypted = ?, token_expires_at = ?, metadata_json = ?, updated_at = ?
    WHERE id = ?`,
    [
      account.platform,
      account.handle,
      account.niche,
      account.display_name,
      account.status,
      account.daily_limit,
      account.style_prompt,
      account.default_cta,
      account.posting_mode,
      account.access_token_encrypted,
      account.refresh_token_encrypted,
      account.token_expires_at,
      jsonString(account.metadata || {}),
      nowIso(),
      id,
    ]
  );
  return getAccount(id);
}

async function deleteAccount(id) {
  await db.ready;
  await db.runQuery('DELETE FROM social_accounts WHERE id = ?', [id]);
  return true;
}

module.exports = {
  createAccount,
  listAccounts,
  getAccount,
  getAccountRaw,
  updateAccount,
  deleteAccount,
};
