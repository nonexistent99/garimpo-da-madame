const db = require('../../src/database/database');
const { createId, nowIso, jsonString, normalizeText, clamp, jaccardSimilarity } = require('../common');
const productsStore = require('../products/products-store');
const nichesStore = require('../niches/niches-store');
const creativesStore = require('../creatives/creatives-store');
const accountsStore = require('../accounts/accounts-store');

const BAD_PHRASES = [
  'oferta imperdivel',
  'voce nao vai acreditar',
  'corra antes que acabe',
  'compre agora',
  'melhor produto do mercado',
  'link na bio agora',
];

function detectLowValuePatterns({ script = '', caption = '' }) {
  const text = normalizeText(`${script} ${caption}`);
  const problems = [];

  const mentionsPrice = /\b(preco|desconto|valor|r\$|link)\b/.test(text);
  const hasAudience = /\b(para quem|serve para|faz sentido para|se voce|quem quer|quem precisa)\b/.test(text);
  const hasBenefit = /\b(ponto forte|motivo|resolve|ajuda|util|beneficio|vale olhar)\b/.test(text);
  const hasCare = /\b(cuidado|limitacao|nao esperar|conferir|verificar|antes de comprar)\b/.test(text);
  const ctaIndex = text.search(/\b(grupo|bio|link|deixei)\b/);
  const valueIndex = text.search(/\b(motivo|serve|faz sentido|ponto forte|cuidado|limitacao)\b/);

  if (mentionsPrice && !hasBenefit && !hasAudience) problems.push('so fala preco/desconto/link');
  if (!hasAudience) problems.push('falta publico-alvo claro');
  if (!hasBenefit) problems.push('falta beneficio ou contexto util');
  if (!hasCare) problems.push('falta ponto honesto ou limitacao');
  if (ctaIndex >= 0 && (valueIndex < 0 || ctaIndex < valueIndex)) problems.push('CTA aparece antes do valor');
  for (const phrase of BAD_PHRASES) {
    if (text.includes(normalizeText(phrase))) problems.push(`frase generica ou agressiva: ${phrase}`);
  }
  if ((script || '').split(/\s+/).length < 25) problems.push('roteiro curto demais para entregar valor');
  if (jaccardSimilarity(script, caption) > 0.92 && script.length > 80) problems.push('legenda e roteiro muito repetidos');

  return problems;
}

function blockIfLowValue(evaluation) {
  if (evaluation.final_score < 6.5) return 'blocked';
  if (evaluation.spam_risk_score > 7) return 'blocked';
  if (evaluation.final_score < 7.5) return 'needs_revision';
  return 'approved';
}

function scoreFromPatterns(problems, creative) {
  const text = normalizeText(`${creative.script || ''} ${creative.caption || ''}`);
  const hookScore = creative.hook && creative.hook.length > 20 ? 8 : 5;
  const utilityScore = problems.includes('falta beneficio ou contexto util') ? 4 : 8;
  const clarityScore = (creative.script || '').length > 80 ? 8 : 5;
  const originalityScore = problems.some(p => p.includes('frase generica')) ? 4 : 7.5;
  const honestyScore = problems.includes('falta ponto honesto ou limitacao') ? 4 : 8.5;
  const nicheFitScore = /\b(serve|faz sentido|para quem|se voce)\b/.test(text) ? 8 : 5;
  const ctaScore = problems.includes('CTA aparece antes do valor') ? 4 : 8;
  const spamRiskScore = clamp(3 + problems.filter(p => /generica|agressiva|preco|CTA/.test(p)).length * 1.8, 0, 10);
  const retentionScore = hookScore >= 8 && utilityScore >= 7 ? 8 : 6;
  const finalScore = (
    hookScore * 0.14 +
    utilityScore * 0.18 +
    clarityScore * 0.12 +
    originalityScore * 0.11 +
    honestyScore * 0.15 +
    nicheFitScore * 0.12 +
    ctaScore * 0.08 +
    (10 - spamRiskScore) * 0.05 +
    retentionScore * 0.05
  );

  return {
    hook_score: round(hookScore),
    utility_score: round(utilityScore),
    clarity_score: round(clarityScore),
    originality_score: round(originalityScore),
    honesty_score: round(honestyScore),
    niche_fit_score: round(nicheFitScore),
    cta_score: round(ctaScore),
    spam_risk_score: round(spamRiskScore),
    retention_score: round(retentionScore),
    final_score: round(finalScore),
  };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function improveCreative({ product, niche, account, creative }) {
  const cta = (account && account.default_cta) || (niche && niche.default_cta) || creative.cta || 'Se ainda estiver nesse preco, deixei no grupo de descontos da bio.';
  const audience = (niche && niche.target_audience) || 'quem quer economizar sem comprar no impulso';
  const price = product && product.current_price ? ` por R$ ${Number(product.current_price).toFixed(2).replace('.', ',')}` : '';
  const rewrite = [
    `Eu achei ${product ? product.name : 'esse produto'}${price} e ele pode fazer sentido para ${audience}.`,
    'O motivo de valer olhar e que ele resolve uma necessidade clara sem depender de promessa exagerada.',
    'O ponto forte e o custo-beneficio para quem ja estava procurando algo parecido.',
    'O cuidado e conferir detalhes, avaliacao e prazo antes de comprar.',
    cta,
  ].join(' ');

  return {
    hook: `Eu achei ${product ? product.name : 'esse produto'} numa faixa que vale olhar.`,
    script: rewrite,
    caption: `${rewrite}\n\n${cta}`,
    cta,
  };
}

async function saveReview({ creativeId, accountId, evaluation }) {
  await db.ready;
  const id = createId('qr');
  await db.runQuery(
    `INSERT INTO creative_quality_reviews (
      id, creative_id, account_id, hook_score, utility_score, clarity_score, originality_score,
      honesty_score, niche_fit_score, cta_score, spam_risk_score, retention_score, final_score,
      status, problems_json, improvements_json, rewrite, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      creativeId,
      accountId || null,
      evaluation.hook_score,
      evaluation.utility_score,
      evaluation.clarity_score,
      evaluation.originality_score,
      evaluation.honesty_score,
      evaluation.niche_fit_score,
      evaluation.cta_score,
      evaluation.spam_risk_score,
      evaluation.retention_score,
      evaluation.final_score,
      evaluation.status,
      jsonString(evaluation.problems || []),
      jsonString(evaluation.improvements || []),
      evaluation.rewrite || null,
      nowIso(),
    ]
  );
  await creativesStore.updateCreative(creativeId, {
    quality_status: evaluation.status,
    quality_score: evaluation.final_score,
  });
  return id;
}

async function evaluateCreativeQuality({ product, niche, account, creative }) {
  const problems = detectLowValuePatterns({ script: creative.script, caption: creative.caption });
  const scores = scoreFromPatterns(problems, creative);
  const improved = improveCreative({ product, niche, account, creative });
  const evaluation = {
    ...scores,
    status: blockIfLowValue(scores),
    problems,
    improvements: problems.length ? [
      'Adicionar publico-alvo explicito.',
      'Mostrar ponto forte e cuidado honesto antes do CTA.',
      'Trocar urgencia agressiva por linguagem leve.',
    ] : ['Conteudo ja entrega contexto, honestidade e CTA leve.'],
    rewrite: improved.script,
  };
  evaluation.review_id = await saveReview({
    creativeId: creative.id,
    accountId: account && account.id,
    evaluation,
  });
  return evaluation;
}

async function evaluateByIds({ creative_id, account_id }) {
  const creative = await creativesStore.getCreative(creative_id);
  if (!creative) throw new Error('criativo nao encontrado');
  const product = await productsStore.getProduct(creative.product_id);
  const niche = product && product.niche ? await nichesStore.getNicheBySlug(product.niche) : null;
  const account = account_id ? await accountsStore.getAccount(account_id) : null;
  return evaluateCreativeQuality({ product, niche, account, creative });
}

module.exports = {
  evaluateCreativeQuality,
  evaluateByIds,
  detectLowValuePatterns,
  improveCreative,
  blockIfLowValue,
};
