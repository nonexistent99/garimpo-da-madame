const fs = require('fs');
const db = require('../../src/database/database');
const productsStore = require('../products/products-store');
const creativesStore = require('../creatives/creatives-store');
const accountsStore = require('../accounts/accounts-store');
const contentQuality = require('../content-quality/content-quality');
const { firstRow, hashText, jaccardSimilarity } = require('../common');

async function runQualityGuard({ product, creative, account, scheduledAt, caption, ignoreQueueId = null }) {
  await db.ready;
  const blocks = [];
  const warnings = [];

  if (!account) blocks.push('Conta inexistente.');
  if (account && !['active', 'warming_up'].includes(account.status)) {
    blocks.push(`Conta com status ${account.status}; use active ou warming_up.`);
  }

  if (!product) blocks.push('Produto inexistente.');
  if (!creative) blocks.push('Criativo inexistente.');

  if (creative) {
    const canSkipVideo = ['draft', 'ready_to_render'].includes(creative.status) && (!account || account.posting_mode !== 'api');
    if (!creative.video_path || !fs.existsSync(creative.video_path)) {
      if (canSkipVideo) warnings.push('Criativo ainda nao tem video renderizado; exportacao manual podera seguir como rascunho.');
      else blocks.push('Video renderizado nao encontrado no disco.');
    }
  }

  if (product && account && product.niche && account.niche && product.niche !== account.niche) {
    blocks.push('Produto nao combina com o nicho da conta.');
  }

  if (account) {
    const realLimit = account.status === 'warming_up'
      ? Math.min(Number(account.daily_limit || 1), 1)
      : Number(account.daily_limit || 2);
    const day = scheduledAt ? String(scheduledAt).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const postedToday = firstRow(await db.getQuery(
      `SELECT COUNT(*) AS count
       FROM published_posts
       WHERE account_id = ? AND date(COALESCE(published_at, created_at)) = date(?)`,
      [account.id, day]
    ));
    const scheduledToday = firstRow(await db.getQuery(
      `SELECT COUNT(*) AS count
       FROM publish_queue
       WHERE account_id = ?
         AND status IN ('waiting_approval', 'scheduled', 'publishing')
         AND date(COALESCE(scheduled_at, created_at)) = date(?)
         AND (? IS NULL OR id != ?)`,
      [account.id, day, ignoreQueueId, ignoreQueueId]
    ));
    const totalToday = Number(postedToday?.count || 0) + Number(scheduledToday?.count || 0);
    if (totalToday >= realLimit) blocks.push(`Limite diario da conta atingido (${realLimit}).`);
  }

  if (account && product) {
    const duplicate = firstRow(await db.getQuery(
      `SELECT id FROM published_posts
       WHERE account_id = ? AND product_id = ? AND datetime(created_at) >= datetime('now', '-72 hours')
       LIMIT 1`,
      [account.id, product.id]
    ));
    if (duplicate) blocks.push('Mesmo produto ja foi publicado nessa conta nas ultimas 72h.');
  }

  const finalCaption = caption || (creative && creative.caption) || '';
  if (!finalCaption.trim()) blocks.push('Legenda vazia.');
  if (!creative || !String(creative.cta || '').trim()) blocks.push('CTA vazio.');

  if (creative) {
    if (creative.quality_status === 'blocked') {
      blocks.push('Creative esta bloqueado pelo Content Quality.');
    } else if (!creative.quality_status) {
      const evaluation = await contentQuality.evaluateByIds({
        creative_id: creative.id,
        account_id: account && account.id,
      });
      creative.quality_status = evaluation.status;
      creative.quality_score = evaluation.final_score;
      if (evaluation.status === 'blocked') blocks.push('Creative bloqueado pelo Content Quality.');
      if (evaluation.status === 'needs_revision') warnings.push('Creative precisa revisao antes de publicar.');
    }
  }

  if (account && creative) {
    const recent = await db.getQuery(
      `SELECT c.script, c.caption
       FROM post_similarity_records r
       JOIN creative_variants c ON c.id = r.creative_id
       WHERE r.account_id = ? AND datetime(r.created_at) >= datetime('now', '-14 days')
       ORDER BY r.created_at DESC LIMIT 20`,
      [account.id]
    );
    for (const row of recent) {
      if (jaccardSimilarity(creative.script || '', row.script || '') > 0.86 || jaccardSimilarity(creative.caption || '', row.caption || '') > 0.9) {
        blocks.push('Roteiro ou legenda muito parecido com posts recentes da mesma conta.');
        break;
      }
    }
  }

  if (creative && creative.video_path) {
    const sameVideo = await db.getQuery(
      `SELECT pp.id
       FROM published_posts pp
       JOIN creative_variants c ON c.id = pp.creative_id
       WHERE c.video_path = ? AND pp.account_id != ?
       LIMIT 1`,
      [creative.video_path, account ? account.id : '']
    );
    if (sameVideo.length) blocks.push('Mesmo arquivo de video ja foi usado em outra conta sem variacao.');
  }

  return {
    passed: blocks.length === 0,
    blocks,
    warnings,
  };
}

async function runQualityGuardByIds({ creative_id, account_id, scheduled_at, caption, ignore_queue_id }) {
  const creative = await creativesStore.getCreative(creative_id);
  const product = creative ? await productsStore.getProduct(creative.product_id) : null;
  const account = account_id ? await accountsStore.getAccount(account_id) : null;
  return runQualityGuard({ product, creative, account, scheduledAt: scheduled_at, caption, ignoreQueueId: ignore_queue_id || null });
}

async function recordSimilarity({ creative, account }) {
  if (!creative || !account) return;
  await db.runQuery(
    `INSERT INTO post_similarity_records (
      id, creative_id, account_id, script_hash, caption_hash, product_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      creative.id,
      account.id,
      hashText(creative.script || ''),
      hashText(creative.caption || ''),
      creative.product_id || null,
    ]
  );
}

module.exports = {
  runQualityGuard,
  runQualityGuardByIds,
  recordSimilarity,
};
