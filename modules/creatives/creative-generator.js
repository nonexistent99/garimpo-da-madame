const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const productsStore = require('../products/products-store');
const nichesStore = require('../niches/niches-store');
const creativesStore = require('./creatives-store');
const { createId, nowIso } = require('../common');

const ROOT = path.join(__dirname, '..', '..');
const OUTPUT_DIR = path.join(ROOT, 'output');
const CAMPAIGNS_DIR = path.join(ROOT, 'campaigns');

const ANGLES = [
  'achado direto',
  'problema -> solucao',
  'comparacao',
  'top lista',
  'honesto com ponto fraco',
  'urgencia leve',
  'curadoria',
];

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `R$ ${number.toFixed(2).replace('.', ',')}`;
}

function productAudience(niche) {
  return (niche && niche.target_audience) || 'quem quer comprar melhor sem gastar demais';
}

function productCare(product) {
  const name = String(product.name || '').toLowerCase();
  if (name.includes('headset') || name.includes('fone')) return 'nao esperar audio profissional se a proposta for economizar';
  if (name.includes('cadeira')) return 'conferir medidas e limite de peso antes de comprar';
  if (name.includes('carregador') || name.includes('cabo')) return 'conferir compatibilidade com seu aparelho';
  if (name.includes('skincare') || name.includes('pele')) return 'verificar composicao e sensibilidade da sua pele';
  return 'conferir avaliacao, prazo e detalhes do vendedor antes de fechar';
}

function buildVariant(product, niche, angle, index) {
  const cta = (niche && niche.default_cta) || 'Se ainda estiver nesse preco, deixei no grupo de descontos da bio.';
  const price = formatPrice(product.current_price);
  const oldPrice = product.old_price ? formatPrice(product.old_price) : '';
  const discount = product.discount_pct ? `${Math.round(product.discount_pct)}%` : '';
  const audience = productAudience(niche);
  const care = productCare(product);
  const benefit = 'o motivo de valer olhar e a combinacao de preco, utilidade e encaixe no nicho';
  const hooks = {
    'achado direto': `Eu achei ${product.name} numa faixa que vale olhar com calma.`,
    'problema -> solucao': `Se voce esta tentando economizar sem comprar qualquer coisa, olha esse achado.`,
    'comparacao': `Antes de pagar mais caro em algo parecido, compara esse ${product.name}.`,
    'top lista': `Colocaria esse achado numa lista curta de ofertas para olhar hoje.`,
    'honesto com ponto fraco': `Esse ${product.name} nao e perfeito, mas pode fazer sentido pelo preco.`,
    'urgencia leve': `Se voce ja estava procurando algo assim, esse preco merece uma checada rapida.`,
    'curadoria': `Garimpei esse item pensando em quem quer compra util e sem exagero.`,
  };

  const script = [
    hooks[angle],
    `Ele faz sentido para ${audience}.`,
    oldPrice && discount ? `Saiu de ${oldPrice} para ${price}, um desconto perto de ${discount}.` : `O preco atual esta em ${price}.`,
    benefit + '.',
    `O ponto forte e resolver uma compra especifica sem parecer gasto por impulso.`,
    `O cuidado e ${care}.`,
    cta,
  ].filter(Boolean).join(' ');

  const onScreen = [
    hooks[angle],
    price ? `Preco: ${price}` : '',
    discount ? `Desconto: ${discount}` : '',
    'Para quem faz sentido?',
    'Ponto forte + cuidado honesto',
    'Se ainda estiver, veja no grupo',
  ].filter(Boolean);

  const hashtags = ['#achados', '#descontos', '#ofertas', '#garimpo'].concat(
    product.niche ? [`#${String(product.niche).replace(/[^a-z0-9_]/gi, '')}`] : []
  );

  return {
    product_id: product.id,
    campaign_id: `campaign_${product.id}_${nowIso().slice(0, 10)}`,
    angle,
    hook: hooks[angle],
    script,
    on_screen_text: onScreen,
    caption: `${hooks[angle]}\n\n${cta}`,
    hashtags,
    cta,
    status: 'ready_to_render',
    _sort: index,
  };
}

async function generateCampaignForProduct(productId, options = {}) {
  const product = await productsStore.getProduct(productId);
  if (!product) throw new Error('produto nao encontrado');
  const niche = product.niche ? await nichesStore.getNicheBySlug(product.niche) : null;
  const count = Math.max(5, Math.min(7, parseInt(options.count || '7', 10) || 7));
  const selectedAngles = ANGLES.slice(0, count);
  const variants = [];

  for (let i = 0; i < selectedAngles.length; i++) {
    const variant = buildVariant(product, niche, selectedAngles[i], i);
    variants.push(await creativesStore.createCreative(variant));
  }

  await productsStore.updateProductStatus(product.id, 'campaign_generated');
  ensureCampaignBundle(product, niche, variants);
  return { product, niche, variants };
}

function ensureCampaignBundle(product, niche, variants) {
  const dir = path.join(CAMPAIGNS_DIR, product.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'creative-brief.json'),
    JSON.stringify({ product, niche, variants, createdAt: nowIso() }, null, 2),
    'utf8'
  );
}

function findFfmpeg() {
  const candidates = [
    process.env.FFMPEG_PATH,
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'ffmpeg',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const result = spawnSync(candidate, ['-version'], { stdio: 'ignore', windowsHide: true });
      if (!result.error && result.status === 0) return candidate;
    } catch {}
  }
  return null;
}

function renderWithFfmpeg(ffmpegPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=#111827:s=1080x1920:d=18',
      '-f', 'lavfi',
      '-i', 'anullsrc=r=44100:cl=stereo',
      '-shortest',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      outputPath,
    ];
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0 && fs.existsSync(outputPath)) resolve(outputPath);
      else reject(new Error(stderr.split(/\r?\n/).slice(-5).join(' ') || `ffmpeg saiu com code ${code}`));
    });
  });
}

async function renderCreative(creativeId) {
  const creative = await creativesStore.getCreative(creativeId);
  if (!creative) throw new Error('criativo nao encontrado');
  await creativesStore.setCreativeStatus(creativeId, 'rendering');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const outputPath = path.join(OUTPUT_DIR, `${creative.id}.mp4`);
  const ffmpegPath = findFfmpeg();
  if (ffmpegPath) {
    await renderWithFfmpeg(ffmpegPath, outputPath);
  } else {
    // If FFmpeg is not installed, keep the flow operable and make the missing dependency explicit.
    fs.writeFileSync(
      outputPath,
      `OFFERS WORKSPACE RENDER PLACEHOLDER\n\nCreative: ${creative.id}\nHook: ${creative.hook}\n\nInstall FFmpeg to generate a real MP4.\n`,
      'utf8'
    );
  }

  return creativesStore.setCreativeStatus(creativeId, 'rendered', { video_path: outputPath });
}

module.exports = {
  ANGLES,
  generateCampaignForProduct,
  renderCreative,
};
