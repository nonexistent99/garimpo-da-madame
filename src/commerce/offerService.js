const fs = require('fs');
const db = require('../database/database');
const { sendWhatsAppMessage, getStatus } = require('../services/whatsappService');

function extractOutputText(payload) {
  if (payload.output_text) return payload.output_text;
  return (payload.output || []).flatMap(item => item.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('\n');
}

async function researchOffer(offer) {
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_RESEARCH_MODEL) return { configurationPending: true, reason: 'Pesquisa e visão não configuradas: defina OPENAI_API_KEY e OPENAI_RESEARCH_MODEL.' };
  const prompt = `Pesquise na web este produto informado por uma loja física de logística reversa: "${offer.exact_name}". O preço informado pela loja é R$ ${(offer.price_cents / 100).toFixed(2)}. Identifique apenas o modelo exato. Selecione uma foto de produto compatível, de fonte legítima e com proveniência explícita, sem montagem promocional, preço sobreposto ou confusão de variantes. Não infira condição, estoque, garantia, desconto ou preço anterior. Responda SOMENTE JSON válido: {"model":"...","model_confidence":0.0,"image_url":"https://...","image_source_page":"https://...","usage_basis":"fabricante|revendedor|licenca_aberta|desconhecida","sources":[{"url":"...","title":"..."}],"caption":"..."}. A legenda deve ser curta, em português brasileiro, chamar para falar com o atendente no WhatsApp e informar que disponibilidade e condição devem ser confirmadas.`;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_RESEARCH_MODEL, tools: [{ type: 'web_search' }], include: ['web_search_call.action.sources'], store: false, input: prompt }),
  });
  if (!response.ok) throw new Error(`Pesquisa falhou (${response.status}).`);
  const raw = await response.json();
  const text = extractOutputText(raw).replace(/^```json\s*|\s*```$/g, '').trim();
  const result = JSON.parse(text);
  if (!Array.isArray(result.sources) || !result.sources.length) return { blocked: true, reason: 'A pesquisa não apresentou proveniência verificável.', raw: result };
  if (Number(result.model_confidence) < 0.85 || !/^https:\/\//.test(result.image_url || '') || !/^https:\/\//.test(result.image_source_page || '') || result.usage_basis === 'desconhecida') {
    return { blocked: true, reason: 'Modelo ou imagem ambíguos. Envie uma foto real.', raw: result };
  }
  const visionResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_RESEARCH_MODEL, store: false, input: [{ role: 'user', content: [
      { type: 'input_text', text: `Compare visualmente esta imagem com o produto exato "${offer.exact_name}" e o modelo pesquisado "${result.model}". Bloqueie se houver outro modelo/variante, montagem, preço ou texto promocional sobreposto, sinais de imagem sintética, baixa legibilidade ou se não for uma foto de produto limpa. Responda SOMENTE JSON: {"exact_match":true,"confidence":0.0,"clean_product_photo":true,"suspected_synthetic":false,"reason":"..."}` },
      { type: 'input_image', image_url: result.image_url, detail: 'high' },
    ] }] }),
  });
  if (!visionResponse.ok) return { blocked: true, reason: `A validação visual falhou (${visionResponse.status}). Envie uma foto real.`, raw: result };
  const visionRaw = await visionResponse.json();
  const vision = JSON.parse(extractOutputText(visionRaw).replace(/^```json\s*|\s*```$/g, '').trim());
  result.vision = vision;
  if (vision.exact_match !== true || vision.clean_product_photo !== true || vision.suspected_synthetic === true || Number(vision.confidence) < 0.9) {
    return { blocked: true, reason: `Imagem bloqueada pela validação visual: ${vision.reason || 'compatibilidade insuficiente'}. Envie uma foto real.`, raw: result };
  }
  return { blocked: false, result };
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
      await db.runQuery("UPDATE store_offers SET status='needs_real_photo', failure_reason=?, research_json=?, updated_at=? WHERE id=?", [researched.reason, JSON.stringify(researched.raw || {}), new Date().toISOString(), id]);
      return;
    }
    const r = researched.result;
    await db.runQuery("UPDATE store_offers SET model_identified=?, confidence=?, selected_image_url=?, image_is_illustrative=1, caption=?, research_json=?, status='ready', failure_reason=NULL, updated_at=? WHERE id=?",
      [r.model, Math.min(Number(r.model_confidence), Number(r.vision.confidence)), r.image_url, r.caption, JSON.stringify({ sources: r.sources, image_url: r.image_url, image_source_page: r.image_source_page, usage_basis: r.usage_basis, vision: r.vision }), new Date().toISOString(), id]);
    await publishOffer(id);
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

module.exports = { processOffer, publishOffer, runOfferWorker, buildCaption };
