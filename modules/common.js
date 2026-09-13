const crypto = require('crypto');

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix = '') {
  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  return prefix ? `${prefix}_${id}` : id;
}

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function jsonString(value) {
  if (value == null) return null;
  return JSON.stringify(value);
}

function toNumber(value, fallback = null) {
  if (value === '' || value == null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(number, min, max) {
  const parsed = Number(number);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashText(value) {
  return crypto.createHash('sha256').update(normalizeText(value)).digest('hex');
}

function jaccardSimilarity(a, b) {
  const wordsA = new Set(normalizeText(a).split(/\s+/).filter(Boolean));
  const wordsB = new Set(normalizeText(b).split(/\s+/).filter(Boolean));
  if (!wordsA.size || !wordsB.size) return 0;
  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }
  return intersection / new Set([...wordsA, ...wordsB]).size;
}

function firstRow(rows) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function publicRecord(row) {
  if (!row) return null;
  const copy = { ...row };
  for (const key of Object.keys(copy)) {
    if (key.endsWith('_json')) {
      copy[key.replace(/_json$/, '')] = safeJsonParse(copy[key], key.includes('hashtags') || key.includes('problems') || key.includes('improvements') ? [] : {});
    }
  }
  return copy;
}

module.exports = {
  nowIso,
  createId,
  safeJsonParse,
  jsonString,
  toNumber,
  clamp,
  normalizeText,
  hashText,
  jaccardSimilarity,
  firstRow,
  publicRecord,
};
