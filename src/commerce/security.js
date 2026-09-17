const crypto = require('crypto');

const sessions = new Map();
const staffSessions = new Map();

function secretKey() {
  const value = process.env.APP_SECRET;
  if (!value || value.length < 32) return null;
  return crypto.createHash('sha256').update(value).digest();
}

function normalizeCpf(value) { return String(value || '').replace(/\D/g, ''); }
function isCpfShapeValid(value) {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let length = 9; length <= 10; length++) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i);
    const digit = (sum * 10) % 11 % 10;
    if (digit !== Number(cpf[length])) return false;
  }
  return true;
}

function isCnpjShapeValid(value) {
  const cnpj = normalizeCpf(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calculateDigit = base => {
    const weights = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = base.split('').reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculateDigit(cnpj.slice(0, 12)) === Number(cnpj[12])
    && calculateDigit(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

function isDocumentShapeValid(value) {
  const document = normalizeCpf(value);
  return document.length === 11 ? isCpfShapeValid(document) : isCnpjShapeValid(document);
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
  if (digits.length === 11) return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  if (digits.length === 14) return `**.***.${digits.slice(5, 8)}/${digits.slice(8, 12)}-**`;
  return 'Documento inválido';
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

function createStaffSession() {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  staffSessions.set(token, { csrf, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
  return { token, csrf };
}

function getStaffSession(req) {
  const token = parseCookies(req.headers.cookie).gm_staff;
  const session = token && staffSessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) staffSessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function requireStaff(req, res, next) {
  const session = getStaffSession(req);
  if (!session) return res.status(401).json({ error: 'Autenticação de atendente necessária.' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-csrf-token'] !== session.csrf) {
    return res.status(403).json({ error: 'Token CSRF inválido.' });
  }
  req.staffSession = session;
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

module.exports = { createSession, getSession, requireAdmin, createStaffSession, getStaffSession, requireStaff, safeEqual, normalizeCpf, encryptCpf, hashCpf, maskCpf, isCpfShapeValid, isCnpjShapeValid, isDocumentShapeValid, randomId, randomToken, tokenHash, sessions, staffSessions };
