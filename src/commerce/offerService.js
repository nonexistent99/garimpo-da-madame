const fs = require('fs');
const db = require('../database/database');
const { sendWhatsAppMessage, getStatus } = require('../services/whatsappService');

function aiConfigured() {
  return Boolean(process.env.NVIDIA_API_KEY && process.env.NVIDIA_TEXT_MODEL && process.env.NVIDIA_VISION_MODEL);
}

function parseJsonContent(payload) {
  const text = payload?.choices?.[0]?.message?.content || '';
  return JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim());
}

async function nvidiaChat(model, messages, maxTokens = 700) {
  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.1, stream: false }),
  });
  if (!response.ok) throw new Error(`NVIDIA respondeu com erro ${response.status}.`);
  return response.json();
}

async function researchOffer(offer) {
  if (!aiConfigured()) return { configurationPending: true, reason: 'IA NVIDIA não configurada. Defina a chave e os modelos de texto e visão.' };
  const prompt = `Você prepara ofertas para uma loja física de logística reversa. O administrador informou "${offer.exact_name}" por R$ ${(offer.price_cents / 100).toFixed(2)}. Não invente variante, condição, estoque, garantia, preço anterior ou desconto. Responda somente JSON válido: {"model":"nome informado normalizado","model_confidence":0.0,"caption":"legenda curta em português brasileiro que mencione o preço e convide a consultar disponibilidade e condição com o atendimento"}.`;
  const result = parseJsonContent(await nvidiaChat(process.env.NVIDIA_TEXT_MODEL, [{ role: 'user', content: prompt }]));
  return { blocked: true, reason: 'Envie uma foto real do produto para a validação visual antes da publicação.', raw: result };
}

async function analyzeRealPhoto(offer, imagePath) {
  if (!aiConfigured()) return { configurationPending: true, reason: 'Configure a integração NVIDIA antes de publicar.' };
  const extension = String(imagePath).toLowerCase().endsWith('.png') ? 'png' : String(imagePath).toLowerCase().endsWith('.webp') ? 'webp' : 'jpeg';
  const imageUrl = `data:image/${extension};base64,${fs.readFileSync(imagePath).toString('base64')}`;
  const prompt = `Analise a foto enviada para uma oferta chamada "${offer.exact_name}" pelo preço R$ ${(offer.price_cents / 100).toFixed(2)}. Bloqueie se o produto visível for incompatível, ilegível, uma montagem promocional, tiver preço/texto sobreposto ou sinais de imagem sintética. Não invente condição, estoque, garantia, preço anterior ou desconto. Responda somente JSON válido: {"model":"produto ou modelo visível","exact_match":true,"confidence":0.0,"clean_product_photo":true,"suspected_synthetic":false,"reason":"...","caption":"legenda curta em português brasileiro com o preço e convite para confirmar disponibilidade e condição no atendimento"}.`;
  const messages = [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }] }];
  const result = parseJsonContent(await nvidiaChat(process.env.NVIDIA_VISION_MODEL, messages, 900));
  const approved = result.exact_match === true && result.clean_product_photo === true && result.suspected_synthetic !== true && Number(result.confidence) >= 0.85;
  return approved ? { blocked: false, result } : { blocked: true, reason: `Foto bloqueada pela validação visual: ${result.reason || 'compatibilidade insuficiente'}.`, raw: result };
}

function buildCaption(offer, settings) {
  const base = String(offer.caption || '').trim() || `${offer.exact_name} por R$ ${(offer.price_cents / 100).toFixed(2).replace('.', ',')}.`;
  const phone = String(settings.support_phone || '').replace(/\D/g, '');
  const contact = phone ? `https://wa.me/${phone}` : 'fale com nosso atendimento';
  const photoNote = offer.image_is_illustrative ? '\n\nFoto ilustrativa de referência; confirme modelo, disponibilidade e condição real com o atendimento.' : '';
  return `${base}\n\n💬 Consulte disponibilidade e condição: ${contact}${photoNote}`;
}

async function processOffer(id) {
  const [offer] = await db.getQuery('SELECT * FROM store_offers WHERE id=?', [id]);
  if (!offer || offer.status !== 'researching') return;
  try {
    const researched = await researchOffer(offer);
    if (researched.configurationPending) {
      await db.runQuery("UPDATE store_offers SET status='configuration_pending', failure_reason=?, updated_at=? WHERE id=?", [researched.reason, new Date().toISOString(), id]);
      return;
    }
    if (researched.blocked) {
      const draft = researched.raw || {};
      await db.runQuery("UPDATE store_offers SET status='needs_real_photo', model_identified=?, confidence=?, caption=?, failure_reason=?, research_json=?, updated_at=? WHERE id=?", [draft.model || offer.exact_name, Number(draft.model_confidence) || 0, draft.caption || null, researched.reason, JSON.stringify(draft), new Date().toISOString(), id]);
      return;
    }
    throw new Error('A validação exige uma foto real antes da publicação.');
  } catch (error) {
    await db.runQuery("UPDATE store_offers SET status='failed', failure_reason=?, updated_at=? WHERE id=?", [String(error.message).slice(0, 300), new Date().toISOString(), id]);
  }
}

async function publishOffer(id) {
  const claim = await db.runQuery("UPDATE store_offers SET status='publishing', publish_attempts=publish_attempts+1, updated_at=? WHERE id=? AND status='ready'", [new Date().toISOString(), id]);
  if (!claim.changes) return false;
  const [[offer], [settings]] = await Promise.all([
    db.getQuery('SELECT * FROM store_offers WHERE id=?', [id]), db.getQuery('SELECT * FROM commerce_settings WHERE id=1'),
  ]);
  if (!settings.destination_group_id) {
    await db.runQuery("UPDATE store_offers SET status='ready', failure_reason='Configure o ID do grupo de destino (não é o link de convite).', updated_at=? WHERE id=?", [new Date().toISOString(), id]);
    return false;
  }
  if (getStatus() !== 'connected') {
    await db.runQuery("UPDATE store_offers SET status='ready', failure_reason='Conecte o WhatsApp para publicar.', updated_at=? WHERE id=?", [new Date().toISOString(), id]);
    return false;
  }
  const image = offer.real_image_path && fs.existsSync(offer.real_image_path) ? offer.real_image_path : offer.selected_image_url;
  const sent = await sendWhatsAppMessage(settings.destination_group_id, buildCaption(offer, settings), image);
  await db.runQuery("UPDATE store_offers SET status=?, failure_reason=?, published_at=?, updated_at=? WHERE id=?",
    sent ? ['published', null, new Date().toISOString(), new Date().toISOString(), id] : ['ready', 'Falha no envio; a oferta permanece pronta para nova tentativa.', null, new Date().toISOString(), id]);
  return sent;
}

async function runOfferWorker() {
  const ready = await db.getQuery("SELECT id FROM store_offers WHERE status='ready' ORDER BY created_at LIMIT 3");
  for (const row of ready) await publishOffer(row.id);
}

module.exports = { processOffer, publishOffer, runOfferWorker, buildCaption, analyzeRealPhoto };
