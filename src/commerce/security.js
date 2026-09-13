const crypto = require('crypto');

const sessions = new Map();

function secretKey() {
  const value = process.env.APP_SECRET;
  if (!value || value.length < 32) return null;
  return crypto.createHash('sha256').update(value).digest();
}

function normalizeCpf(value) { return String(value || '').replace(/\D/g, ''); }
function isCpfShapeValid(value) {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let factor = 10; factor >= 9; factor--) {
    const length = factor === 10 ? 9 : 10;
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (factor - i);
    const digit = (sum * 10) % 11 % 10;
    if (digit !== Number(cpf[length])) return false;
  }
  return true;
}

function encryptCpf(cpf) {
  const key = secretKey();
  if (!key) throw new Error('APP_SECRET não configurado');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(normalizeCpf(cpf), 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function hashCpf(cpf) {
  const key = secretKey();
  if (!key) throw new Error('APP_SECRET não configurado');
  return crypto.createHmac('sha256', key).update(normalizeCpf(cpf)).digest('hex');
}

function maskCpf(cpf) {
  const digits = normalizeCpf(cpf);
  return digits.length === 11 ? `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**` : '***.***.***-**';
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(v => v.trim().split('=').map(decodeURIComponent)).filter(v => v.length === 2));
}

function createSession() {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  sessions.set(token, { csrf, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
  return { token, csrf };
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie).gm_admin;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function requireAdmin(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Autenticação administrativa necessária.' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-csrf-token'] !== session.csrf) {
    return res.status(403).json({ error: 'Token CSRF inválido.' });
  }
  req.adminSession = session;
  next();
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function randomId(prefix) { return `${prefix}_${crypto.randomBytes(12).toString('hex')}`; }
function randomToken() { return crypto.randomBytes(32).toString('base64url'); }
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

module.exports = { createSession, getSession, requireAdmin, safeEqual, normalizeCpf, encryptCpf, hashCpf, maskCpf, isCpfShapeValid, randomId, randomToken, tokenHash, sessions };
