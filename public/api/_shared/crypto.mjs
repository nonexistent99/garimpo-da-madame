import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function safeEqual(value, expected) {
  if (!value || !expected) return false;
  const left = Buffer.from(String(value));
  const right = Buffer.from(String(expected));
  return left.length === right.length && timingSafeEqual(left, right);
}

export const hash = value => createHash('sha256').update(String(value)).digest('hex');
export const hmacHex = (value, secret) => createHmac('sha256', String(secret || '')).update(String(value)).digest('hex');

function encryptionKey(encodedKey) {
  const key = Buffer.from(String(encodedKey || ''), 'base64');
  if (key.length !== 32) throw new Error('LASTLINK_DATA_KEY_INVALID');
  return key;
}

export function keyedHash(value, encodedKey) {
  return createHmac('sha256', encryptionKey(encodedKey)).update(String(value)).digest('hex');
}

export function encryptJson(value, encodedKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(encodedKey), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
}

export function decryptJson(payload, encodedKey) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(encodedKey), Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}
