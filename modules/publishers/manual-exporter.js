const fs = require('fs');
const path = require('path');
const BasePublisher = require('./base-publisher');

const ROOT = path.join(__dirname, '..', '..');
const EXPORTS_DIR = path.join(ROOT, 'exports');

function safeSegment(value) {
  return String(value || 'account')
    .replace(/^@/, '')
    .replace(/[^a-z0-9_-]+/gi, '_')
    .slice(0, 80) || 'account';
}

class ManualExporter extends BasePublisher {
  async publish({ account, creative, product, caption, trackingUrl }) {
    this.validateAccount(account);
    const date = new Date().toISOString().slice(0, 10);
    const dir = path.join(EXPORTS_DIR, date, safeSegment(account.handle), creative.id);
    fs.mkdirSync(dir, { recursive: true });

    let exportedVideoPath = null;
    if (creative.video_path && fs.existsSync(creative.video_path)) {
      exportedVideoPath = path.join(dir, path.basename(creative.video_path));
      fs.copyFileSync(creative.video_path, exportedVideoPath);
    }

    const finalCaption = caption || creative.caption || '';
    fs.writeFileSync(path.join(dir, 'caption.txt'), finalCaption, 'utf8');
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
      product,
      creative,
      account,
      caption: finalCaption,
      trackingUrl,
      affiliateUrl: product && product.affiliate_url,
      recommendedPlatform: account.platform,
      createdAt: new Date().toISOString(),
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(dir, 'checklist.txt'), [
      '- Abrir conta correta',
      '- Conferir video',
      '- Conferir legenda',
      '- Conferir CTA',
      '- Conferir link da bio ou tracking link',
      '- Postar',
      '- Copiar URL do post',
      '- Registrar URL no sistema',
      '',
    ].join('\n'), 'utf8');

    return {
      status: 'exported',
      public_url: dir,
      platform_post_id: null,
      exportedVideoPath,
      warning: account.posting_mode === 'api' ? 'API nao configurada; pacote manual exportado.' : null,
    };
  }
}

module.exports = ManualExporter;
