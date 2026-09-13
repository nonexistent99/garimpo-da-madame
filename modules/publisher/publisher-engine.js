const db = require('../../src/database/database');
const productsStore = require('../products/products-store');
const creativesStore = require('../creatives/creatives-store');
const accountsStore = require('../accounts/accounts-store');
const queueStore = require('./publish-queue-store');
const qualityGuard = require('../quality-guard/quality-guard');
const tracking = require('../tracking/tracking-engine');
const ManualExporter = require('../publishers/manual-exporter');
const TelegramPublisher = require('../publishers/telegram-publisher');
const TikTokPublisher = require('../publishers/tiktok-publisher');
const InstagramPublisher = require('../publishers/instagram-publisher');
const YouTubePublisher = require('../publishers/youtube-publisher');
const KwaiPublisher = require('../publishers/kwai-publisher');

async function loadBundle({ creativeId, accountId }) {
  const creative = await creativesStore.getCreative(creativeId);
  if (!creative) throw new Error('criativo nao encontrado');
  const product = await productsStore.getProduct(creative.product_id);
  if (!product) throw new Error('produto nao encontrado');
  const account = await accountsStore.getAccount(accountId);
  if (!account) throw new Error('conta nao encontrada');
  return { creative, product, account };
}

async function createQueueItem(input) {
  const { creative, product, account } = await loadBundle({ creativeId: input.creative_id, accountId: input.account_id });
  const guard = await qualityGuard.runQualityGuard({
    product,
    creative,
    account,
    scheduledAt: input.scheduled_at,
    caption: input.caption,
  });
  if (!guard.passed) {
    const error = new Error('Quality Guard bloqueou a fila');
    error.details = guard;
    throw error;
  }

  const item = await queueStore.createQueueItem({
    creative_id: creative.id,
    product_id: product.id,
    account_id: account.id,
    scheduled_at: input.scheduled_at || null,
    caption: input.caption || creative.caption,
    status: input.scheduled_at ? 'scheduled' : 'waiting_approval',
  });

  return { item, guard };
}

async function approveQueueItem(id) {
  const item = await queueStore.getQueueItem(id);
  if (!item) throw new Error('item de fila nao encontrado');
  return queueStore.updateQueueItem(id, { status: 'scheduled' });
}

function selectPublisher(account) {
  if (account.platform === 'kwai') return new KwaiPublisher();
  if (account.posting_mode === 'manual' || account.posting_mode === 'export_only') return new ManualExporter();
  if (account.platform === 'telegram') return new TelegramPublisher();
  if (account.platform === 'tiktok') return new TikTokPublisher();
  if (account.platform === 'instagram') return new InstagramPublisher();
  if (account.platform === 'youtube') return new YouTubePublisher();
  return new ManualExporter();
}

async function publishQueueItem(id) {
  const item = await queueStore.getQueueItem(id);
  if (!item) throw new Error('item de fila nao encontrado');
  const { creative, product, account } = await loadBundle({ creativeId: item.creative_id, accountId: item.account_id });
  const guard = await qualityGuard.runQualityGuard({
    product,
    creative,
    account,
    scheduledAt: item.scheduled_at,
    caption: item.caption,
    ignoreQueueId: item.id,
  });
  if (!guard.passed) {
    await queueStore.updateQueueItem(id, { status: 'failed', error_message: guard.blocks.join(' | ') });
    const error = new Error('Quality Guard bloqueou publicacao');
    error.details = guard;
    throw error;
  }

  await queueStore.updateQueueItem(id, { status: 'publishing', error_message: null });
  const trackingCode = tracking.createTrackingCode({ product, creative, account });
  const trackingUrl = tracking.buildTrackingUrl(trackingCode);
  let publisher = selectPublisher(account);
  let publishResult;

  try {
    publishResult = await publisher.publish({
      account,
      creative,
      product,
      caption: item.caption || creative.caption,
      trackingUrl,
    });
  } catch (error) {
    publisher = new ManualExporter();
    publishResult = await publisher.publish({
      account: { ...account, posting_mode: 'export_only' },
      creative,
      product,
      caption: item.caption || creative.caption,
      trackingUrl,
    });
    publishResult.warning = error.message;
  }

  const finalStatus = publishResult.status === 'published' ? 'published' : 'published';
  await tracking.createPublishedPost({
    creative_id: creative.id,
    product_id: product.id,
    account_id: account.id,
    platform: account.platform,
    platform_post_id: publishResult.platform_post_id,
    public_url: publishResult.public_url,
    tracking_code: trackingCode,
    status: publishResult.status,
  });
  await qualityGuard.recordSimilarity({ creative, account });
  await queueStore.updateQueueItem(id, { status: finalStatus, error_message: publishResult.warning || null });
  await creativesStore.updateCreative(creative.id, { status: publishResult.status === 'exported' ? 'exported' : 'published' });

  return {
    queue_id: id,
    status: publishResult.status,
    tracking_code: trackingCode,
    tracking_url: trackingUrl,
    public_url: publishResult.public_url,
    warning: publishResult.warning || null,
  };
}

async function exportNow({ creative_id, account_id }) {
  const { creative, product, account } = await loadBundle({ creativeId: creative_id, accountId: account_id });
  const guard = await qualityGuard.runQualityGuard({ product, creative, account, caption: creative.caption });
  if (!guard.passed) {
    const error = new Error('Quality Guard bloqueou exportacao');
    error.details = guard;
    throw error;
  }
  const trackingCode = tracking.createTrackingCode({ product, creative, account });
  const trackingUrl = tracking.buildTrackingUrl(trackingCode);
  const result = await new ManualExporter().publish({ account, creative, product, caption: creative.caption, trackingUrl });
  await tracking.createPublishedPost({
    creative_id,
    product_id: product.id,
    account_id,
    platform: account.platform,
    public_url: result.public_url,
    tracking_code: trackingCode,
    status: 'exported',
  });
  await qualityGuard.recordSimilarity({ creative, account });
  await creativesStore.updateCreative(creative.id, { status: 'exported' });
  return { ...result, tracking_code: trackingCode, tracking_url: trackingUrl, guard };
}

async function cancelQueueItem(id) {
  return queueStore.updateQueueItem(id, { status: 'canceled' });
}

module.exports = {
  createQueueItem,
  approveQueueItem,
  publishQueueItem,
  exportNow,
  cancelQueueItem,
};
