if (process.env.DATABASE_URL) {
  module.exports = require('./postgresDatabase');
} else {
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

let dbPath = process.env.DATABASE_PATH || process.env.DB_PATH || path.join(__dirname, '../../data/app.db');
const legacyDbPath = path.join(__dirname, '../../data/database.sqlite');

if (!process.env.DATABASE_PATH && !process.env.DB_PATH && fs.existsSync(legacyDbPath) && !fs.existsSync(dbPath)) {
  dbPath = legacyDbPath;
}

if (!path.isAbsolute(dbPath)) {
  dbPath = path.resolve(__dirname, '../../', dbPath);
}

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let resolveReady;
let rejectReady;
const ready = new Promise((res, rej) => {
  resolveReady = res;
  rejectReady = rej;
});

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao conectar ao banco de dados:', err.message);
    rejectReady(err);
    return;
  }

  console.log('Conectado ao banco de dados SQLite:', dbPath);
  initDb()
    .then(() => {
      console.log('[SQLite] Inicializacao completa.');
      resolveReady();
    })
    .catch(error => {
      console.error('[SQLite] Falha na inicializacao:', error.message);
      rejectReady(error);
    });
});

function runSync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getSync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initDb() {
  await createLegacyTables();
  await createOffersWorkspaceTables();
  await createCommerceTables();
  await runLegacyMigrations();
  await createIndexes();
  await seedLegacyGroups();
  await seedOffersWorkspaceNiches();
}

async function createCommerceTables() {
  await runSync(`CREATE TABLE IF NOT EXISTS commerce_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    access_name TEXT NOT NULL,
    access_description TEXT NOT NULL,
    price_cents INTEGER,
    sales_status TEXT NOT NULL DEFAULT 'paused',
    invite_url TEXT,
    support_phone TEXT,
    destination_group_id TEXT,
    email_subject TEXT NOT NULL,
    email_body TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  await runSync(`INSERT OR IGNORE INTO commerce_settings
    (id, access_name, access_description, sales_status, email_subject, email_body, updated_at)
    VALUES (1, 'Grupo privado Garimpo da Madame', 'Curadoria de achados e alertas de produtos disponíveis.', 'paused',
      'Seu acesso ao Garimpo da Madame foi liberado',
      'Olá, {{nome}}! Seu pagamento foi confirmado. Abra sua página segura para acessar o convite: {{link_acesso}}\n\nDúvidas: {{suporte}}',
      datetime('now'))`);

  await runSync(`CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, cpf_encrypted TEXT NOT NULL,
    cpf_hash TEXT NOT NULL, cpf_mask TEXT NOT NULL, phone TEXT NOT NULL, terms_accepted_at TEXT NOT NULL,
    marketing_opt_in INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  )`);
  await runSync(`CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, access_group_key TEXT NOT NULL DEFAULT 'primary', amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'BRL', status TEXT NOT NULL DEFAULT 'pending',
    provider_payment_id TEXT UNIQUE, provider_status TEXT, pix_code TEXT, pix_qr_base64 TEXT,
    approved_at TEXT, redeem_token_hash TEXT UNIQUE, redeem_expires_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  await runSync(`CREATE TABLE IF NOT EXISTS webhook_events (
    provider TEXT NOT NULL, event_key TEXT NOT NULL, received_at TEXT NOT NULL,
    processed_at TEXT, result TEXT, PRIMARY KEY(provider, event_key)
  )`);
  await runSync(`CREATE TABLE IF NOT EXISTS invite_history (
    id TEXT PRIMARY KEY, invite_url TEXT, changed_at TEXT NOT NULL, changed_by TEXT NOT NULL
  )`);
  await runSync(`CREATE TABLE IF NOT EXISTS email_jobs (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, recipient TEXT NOT NULL, subject TEXT NOT NULL,
    body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL, last_error TEXT, sent_at TEXT, created_at TEXT NOT NULL
  )`);
  await runSync(`CREATE TABLE IF NOT EXISTS store_offers (
    id TEXT PRIMARY KEY, access_group_key TEXT NOT NULL DEFAULT 'primary', exact_name TEXT NOT NULL, price_cents INTEGER NOT NULL,
    real_image_path TEXT, selected_image_url TEXT, image_is_illustrative INTEGER NOT NULL DEFAULT 0,
    model_identified TEXT, confidence REAL, caption TEXT, research_json TEXT,
    status TEXT NOT NULL, failure_reason TEXT, publish_attempts INTEGER NOT NULL DEFAULT 0,
    published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  await runSync('CREATE INDEX IF NOT EXISTS idx_orders_customer_status ON orders(customer_id, status)');
  await runSync('CREATE INDEX IF NOT EXISTS idx_email_jobs_status ON email_jobs(status, next_attempt_at)');
  await runSync('CREATE INDEX IF NOT EXISTS idx_store_offers_status ON store_offers(status, created_at)');
  await safeAddColumn('customers', 'cpf_mask', "TEXT NOT NULL DEFAULT '***.***.***-**'");
  await safeAddColumn('orders', 'access_group_key', "TEXT NOT NULL DEFAULT 'primary'");
  await safeAddColumn('store_offers', 'access_group_key', "TEXT NOT NULL DEFAULT 'primary'");
}

async function createLegacyTables() {
  await runSync(`CREATE TABLE IF NOT EXISTS sent_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    affiliate_link TEXT NOT NULL,
    niche TEXT,
    asin TEXT,
    title_hash TEXT,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await runSync(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    niche TEXT NOT NULL,
    platform TEXT NOT NULL,
    target_id TEXT NOT NULL
  )`);

  await runSync(`CREATE TABLE IF NOT EXISTS whatsapp_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL,
    message TEXT NOT NULL,
    niche TEXT NOT NULL,
    image_url TEXT,
    status TEXT DEFAULT 'pending',
    retries INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

async function createOffersWorkspaceTables() {
  // Offers Workspace lives beside the legacy bot tables so the old flow keeps working.
  await runSync(`CREATE TABLE IF NOT EXISTS niches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    target_audience TEXT,
    allowed_product_types TEXT,
    tone TEXT,
    default_cta TEXT,
    created_at TEXT,
    updated_at TEXT
  )`);

  await runSync(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    niche TEXT,
    old_price REAL,
    current_price REAL,
    discount_pct REAL,
    image_url TEXT,
    affiliate_url TEXT,
    source TEXT,
    score REAL,
    status TEXT DEFAULT 'new',
    metadata_json TEXT,
    created_at TEXT,
    updated_at TEXT
  )`);

  await runSync(`CREATE TABLE IF NOT EXISTS creative_variants (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    campaign_id TEXT,
    angle TEXT,
    hook TEXT,
    script TEXT,
    on_screen_text_json TEXT,
    caption TEXT,
    hashtags_json TEXT,
    cta TEXT,
    video_path TEXT,
    audio_path TEXT,
    status TEXT DEFAULT 'draft',
    quality_status TEXT,
    quality_score REAL,
    created_at TEXT,
    updated_at TEXT
  )`);

  await runSync(`CREATE TABLE IF NOT EXISTS social_accounts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    handle TEXT NOT NULL,
    niche TEXT,
    display_name TEXT,
    status TEXT DEFAULT 'active',
    daily_limit INTEGER DEFAULT 2,
    style_prompt TEXT,
    default_cta TEXT,
    posting_mode TEXT DEFAULT 'manual',
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    token_expires_at TEXT,
    metadata_json TEXT,
    created_at TEXT,
    updated_at TEXT
  )`);

  await runSync(`CREATE TABLE IF NOT EXISTS publish_queue (
    id TEXT PRIMARY KEY,
    creative_id TEXT NOT NULL,
    product_id TEXT,
    account_id TEXT NOT NULL,
    scheduled_at TEXT,
    caption TEXT,
    status TEXT DEFAULT 'draft',
    error_message TEXT,
    quality_review_id TEXT,
    created_at TEXT,
    updated_at TEXT
  )`);

  await runSync(`CREATE TABLE IF NOT EXISTS published_posts (
    id TEXT PRIMARY KEY,
    creative_id TEXT,
    product_id TEXT,
    account_id TEXT,
    platform TEXT,
    platform_post_id TEXT,
    public_url TEXT,
    tracking_code TEXT,
    status TEXT,
    published_at TEXT,
    created_at TEXT
  )`);

  await runSync(`CREATE TABLE IF NOT EXISTS tracking_events (
    id TEXT PRIMARY KEY,
    tracking_code TEXT,
    event_type TEXT,
    source TEXT,
    account_id TEXT,
    product_id TEXT,
    creative_id TEXT,
    metadata_json TEXT,
    created_at TEXT
  )`);

  await runSync(`CREATE TABLE IF NOT EXISTS creative_quality_reviews (
    id TEXT PRIMARY KEY,
    creative_id TEXT,
    account_id TEXT,
    hook_score REAL,
    utility_score REAL,
    clarity_score REAL,
    originality_score REAL,
    honesty_score REAL,
    niche_fit_score REAL,
    cta_score REAL,
    spam_risk_score REAL,
    retention_score REAL,
    final_score REAL,
    status TEXT,
    problems_json TEXT,
    improvements_json TEXT,
    rewrite TEXT,
    created_at TEXT
  )`);

  await runSync(`CREATE TABLE IF NOT EXISTS post_similarity_records (
    id TEXT PRIMARY KEY,
    creative_id TEXT,
    account_id TEXT,
    script_hash TEXT,
    caption_hash TEXT,
    product_id TEXT,
    created_at TEXT
  )`);
}

async function runLegacyMigrations() {
  await safeAddColumn('sent_products', 'asin', 'TEXT');
  await safeAddColumn('sent_products', 'title_hash', 'TEXT');
  await safeAddColumn('whatsapp_queue', 'retries', 'INTEGER DEFAULT 0');
}

async function createIndexes() {
  try {
    await runSync('DROP INDEX IF EXISTS idx_sent_products_asin');
    await runSync('DROP INDEX IF EXISTS idx_sent_products_title_hash');
    await runSync('DROP INDEX IF EXISTS idx_sent_products_affiliate_link');

    await runSync('CREATE INDEX IF NOT EXISTS idx_sent_products_asin_niche ON sent_products(asin, niche)');
    await runSync('CREATE INDEX IF NOT EXISTS idx_sent_products_title_hash_niche ON sent_products(title_hash, niche)');
    await runSync('CREATE INDEX IF NOT EXISTS idx_sent_products_sent_at ON sent_products(sent_at)');
    await runSync('CREATE INDEX IF NOT EXISTS idx_wa_queue_status ON whatsapp_queue(status, created_at)');

    await runSync('CREATE INDEX IF NOT EXISTS idx_products_niche_status ON products(niche, status, score)');
    await runSync('CREATE INDEX IF NOT EXISTS idx_creatives_product ON creative_variants(product_id, status)');
    await runSync('CREATE INDEX IF NOT EXISTS idx_accounts_niche_platform ON social_accounts(niche, platform, status)');
    await runSync('CREATE INDEX IF NOT EXISTS idx_publish_queue_status ON publish_queue(status, scheduled_at)');
    await runSync('CREATE INDEX IF NOT EXISTS idx_published_posts_tracking ON published_posts(tracking_code)');
    await runSync('CREATE INDEX IF NOT EXISTS idx_tracking_events_code ON tracking_events(tracking_code, created_at)');
  } catch (err) {
    console.error('[SQLite] Aviso ao criar indices:', err.message);
  }
}

async function seedLegacyGroups() {
  const row = await new Promise((resolve) => {
    db.get('SELECT COUNT(*) as count FROM groups', (err, r) => resolve(r || { count: -1 }));
  });

  if (row.count !== 0) return;

  console.log('[SQLite Seeder] Semeando canais e grupos padrao.');
  const defaults = [
    ['Cozinha', 'telegram', '@garimpodigitalprimehub'],
    ['Beleza feminina', 'telegram', '@ofertasvaultbrasil247'],
    ['Eletronicos', 'telegram', '@primeachadosxbrasil'],
    ['Gamer', 'telegram', '@descontosecretoshubbr'],
    ['Pet', 'telegram', '@garimpoeliteoficialbr'],
    ['Leitura', 'telegram', '@ofertasquanticasprime'],
    ['Academia_Fitness', 'telegram', '@achadosblackvaultbr'],
    ['Mobile_Games', 'telegram', '@primeimpulsodealsbr'],
    ['Gamer', 'whatsapp', '120363408801824800@g.us'],
    ['Cozinha', 'whatsapp', '120363427235389022@g.us'],
    ['Eletronicos', 'whatsapp', '120363407495964635@g.us'],
    ['Beleza feminina', 'whatsapp', '120363427802091162@g.us'],
    ['Pet', 'whatsapp', '120363410226131492@g.us'],
    ['Leitura', 'whatsapp', '120363426209729628@g.us'],
    ['Academia_Fitness', 'whatsapp', '120363426157432603@g.us'],
    ['Mobile_Games', 'whatsapp', '120363427376215727@g.us'],
  ];

  for (const [niche, platform, targetId] of defaults) {
    await runSync('INSERT INTO groups (niche, platform, target_id) VALUES (?, ?, ?)', [niche, platform, targetId]);
  }
}

async function seedOffersWorkspaceNiches() {
  const now = new Date().toISOString();
  const defaults = [
    {
      id: 'gamer_setup',
      name: 'Gamer / Setup',
      slug: 'gamer_setup',
      description: 'Produtos para setup gamer, perifericos, cadeira, controle, monitor, RGB e acessorios.',
      target_audience: 'Jovens e adultos que querem montar setup gamer gastando pouco.',
      allowed_product_types: 'headset, teclado, mouse, mousepad, cadeira, controle, monitor, suporte, luz RGB, acessorios gamer',
      tone: 'amigo garimpando oferta, linguagem jovem, direta e honesta',
      default_cta: 'Se ainda estiver nesse preco, deixei no grupo de setup barato da bio.'
    },
    {
      id: 'casa_utilidades',
      name: 'Casa / Utilidades',
      slug: 'casa_utilidades',
      description: 'Produtos uteis para casa, organizacao, limpeza, cozinha, praticidade e decoracao.',
      target_audience: 'Pessoas que querem economizar em produtos uteis para o dia a dia.',
      allowed_product_types: 'organizadores, utensilios, cozinha, limpeza, decoracao, iluminacao, ferramentas domesticas',
      tone: 'pratico, util, simples e confiavel',
      default_cta: 'Se ainda estiver no valor, coloquei no grupo de achados para casa da bio.'
    },
    {
      id: 'beleza_autocuidado',
      name: 'Beleza / Autocuidado',
      slug: 'beleza_autocuidado',
      description: 'Produtos de beleza, skincare, cabelo, autocuidado e acessorios.',
      target_audience: 'Pessoas que gostam de se cuidar gastando menos.',
      allowed_product_types: 'skincare, cabelo, maquiagem, escovas, secadores, perfumes, acessorios, autocuidado',
      tone: 'proximo, cuidadoso, honesto e sem promessas exageradas',
      default_cta: 'Se ainda estiver com desconto, deixei no grupo de beleza da bio.'
    },
    {
      id: 'tech_eletronicos',
      name: 'Eletronicos / Tech',
      slug: 'tech_eletronicos',
      description: 'Eletronicos, gadgets, acessorios, cabos, carregadores, fones, smart devices e perifericos.',
      target_audience: 'Pessoas que gostam de tecnologia e querem comprar melhor.',
      allowed_product_types: 'fones, carregadores, cabos, powerbanks, gadgets, smartwatches, acessorios tech, hubs, suportes',
      tone: 'tecnico simples, direto, comparativo e util',
      default_cta: 'Se ainda estiver nesse preco, deixei no grupo tech da bio.'
    },
    {
      id: 'mercado_economia',
      name: 'Mercado / Economia Diaria',
      slug: 'mercado_economia',
      description: 'Produtos de mercado, higiene, limpeza, alimentos nao pereciveis e economia domestica.',
      target_audience: 'Pessoas que querem economizar nas compras recorrentes.',
      allowed_product_types: 'mercado, limpeza, higiene, alimentos, bebidas nao alcoolicas, itens de casa recorrentes',
      tone: 'economia pratica, direto ao ponto e familiar',
      default_cta: 'Se ainda estiver valendo, deixei no grupo de economia diaria da bio.'
    }
  ];

  for (const niche of defaults) {
    await runSync(
      `INSERT OR IGNORE INTO niches (
        id, name, slug, description, target_audience, allowed_product_types, tone, default_cta, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        niche.id,
        niche.name,
        niche.slug,
        niche.description,
        niche.target_audience,
        niche.allowed_product_types,
        niche.tone,
        niche.default_cta,
        now,
        now
      ]
    );
  }
}

async function safeAddColumn(table, column, definition) {
  try {
    const rows = await getSync(`PRAGMA table_info(${table})`);
    const exists = rows.some(r => r.name === column);
    if (exists) return false;

    await runSync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[SQLite Migracao] Coluna "${column}" adicionada em ${table}.`);
    return true;
  } catch (err) {
    if (err.message && /duplicate column/i.test(err.message)) return false;
    console.error(`[SQLite Migracao] Falha ao adicionar ${column} em ${table}:`, err.message);
    return false;
  }
}

function runQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = {
  db,
  runQuery,
  getQuery,
  ready,
  safeAddColumn,
  dbPath,
};
}
