import { hash, keyedHash } from './crypto.mjs';

const read = (object, ...keys) => {
  for (const key of keys) if (object && object[key] !== undefined) return object[key];
  return undefined;
};

export function cleanText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function normalizeCpf(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 14);
}

export function validCpf(value) {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = length => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

export function validCnpj(value) {
  const cnpj = normalizeCpf(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digit = base => {
    const weights = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = base.split('').reduce((total, number, index) => total + Number(number) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return digit(cnpj.slice(0, 12)) === Number(cnpj[12]) && digit(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

export function validDocument(value) {
  const document = normalizeCpf(value);
  return document.length === 11 ? validCpf(document) : validCnpj(document);
}

export function maskCpf(cpf) {
  const document = normalizeCpf(cpf);
  if (document.length === 14) return `**.***.${document.slice(5, 8)}/${document.slice(8, 12)}-**`;
  return `***.${document.slice(3, 6)}.${document.slice(6, 9)}-**`;
}

export function cpfKey(cpf, dataKey) {
  return `cpf/${keyedHash(normalizeCpf(cpf), dataKey)}`;
}

export function paymentKey(paymentId) {
  return `orders/${hash(paymentId)}`;
}

export function eventKey(eventId) {
  return `events/${hash(eventId)}`;
}

export function extractLastlink(payload) {
  const data = read(payload, 'Data', 'data') || {};
  const buyer = read(data, 'Buyer', 'buyer') || {};
  const purchase = read(data, 'Purchase', 'purchase') || {};
  const offer = read(data, 'Offer', 'offer') || {};
  const products = read(data, 'Products', 'products') || [];
  const price = read(read(purchase, 'Price', 'price') || {}, 'Value', 'value');
  return {
    eventId: cleanText(read(payload, 'Id', 'id'), 160),
    event: cleanText(read(payload, 'Event', 'event'), 80),
    isTest: read(payload, 'IsTest', 'isTest') === true,
    createdAt: cleanText(read(payload, 'CreatedAt', 'createdAt'), 80),
    paymentId: cleanText(read(purchase, 'PaymentId', 'paymentId'), 160),
    amountCents: Number.isFinite(Number(price)) ? Math.round(Number(price) * 100) : null,
    paymentMethod: cleanText(read(read(purchase, 'Payment', 'payment') || {}, 'PaymentMethod', 'paymentMethod'), 40),
    offerId: cleanText(read(offer, 'Id', 'id'), 160),
    productIds: Array.isArray(products) ? products.map(product => cleanText(read(product, 'Id', 'id'), 160)).filter(Boolean) : [],
    buyer: {
      name: cleanText(read(buyer, 'Name', 'name'), 120),
      email: cleanText(read(buyer, 'Email', 'email'), 180).toLowerCase(),
      phone: String(read(buyer, 'PhoneNumber', 'phoneNumber') || '').replace(/\D/g, '').slice(0, 15),
      cpf: normalizeCpf(read(buyer, 'Document', 'document')),
    },
  };
}

export function validatePurchase(event) {
  if (event.event !== 'Purchase_Order_Confirmed') return 'event_not_supported';
  if (!event.eventId || !event.paymentId) return 'missing_identifiers';
  if (!Number.isInteger(event.amountCents) || event.amountCents <= 0) return 'amount_missing';
  if (event.buyer.name.length < 3) return 'buyer_name_missing';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(event.buyer.email)) return 'buyer_email_invalid';
  if (!validDocument(event.buyer.cpf)) return 'buyer_document_invalid';
  if (event.buyer.phone.length < 10) return 'buyer_phone_invalid';
  return null;
}

export function safeDate(value) {
  const parsed = new Date(value || '');
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export function maskName(value) {
  const parts = cleanText(value, 120).split(/\s+/).filter(Boolean);
  return parts.length ? `${parts[0]}${parts.length > 1 ? ` ${parts.at(-1)[0]}.` : ''}` : 'Cliente';
}
