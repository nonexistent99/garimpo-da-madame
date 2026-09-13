const crypto = require('crypto');

function getKey() {
  const raw = process.env.ENCRYPTION_KEY || 'change_me_32_chars_minimum_local_dev_key';
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptToken(token) {
  if (!token) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url')
  ].join('.');
}

function decryptToken(encrypted) {
  if (!encrypted) return null;
  const parts = String(encrypted).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('token criptografado invalido');
  }
  const [, ivValue, tagValue, encryptedValue] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

function maskToken(token) {
  if (!token) return null;
  const value = String(token);
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

module.exports = {
  encryptToken,
  decryptToken,
  maskToken,
};
