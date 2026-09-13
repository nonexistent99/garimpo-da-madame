const { Pool } = require('pg');

const sslEnabled = /^(1|true|require)$/i.test(process.env.DATABASE_SSL || '');
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DATABASE_POOL_SIZE || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

function placeholders(sql) {
  let position = 0;
  return sql.replace(/\?/g, () => `$${++position}`);
}

function portableSql(sql) {
  return placeholders(sql)
    .replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
}

async function runQuery(query, params = []) {
  const sql = portableSql(query);
  const hasIgnore = /INSERT\s+OR\s+IGNORE\s+INTO/i.test(query);
  const result = await db.query(hasIgnore ? `${sql} ON CONFLICT DO NOTHING` : sql, params);
  return { changes: result.rowCount, lastID: result.rows[0]?.id };
}

async function getQuery(query, params = []) {
  const result = await db.query(portableSql(query), params);
  return result.rows;
}

const schema = `
CREATE TABLE IF NOT EXISTS commerce_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1), access_name TEXT NOT NULL, access_description TEXT NOT NULL,
  price_cents INTEGER, sales_status TEXT NOT NULL DEFAULT 'paused', invite_url TEXT, support_phone TEXT,
  destination_group_id TEXT, email_subject TEXT NOT NULL, email_body TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, cpf_encrypted TEXT NOT NULL,
  cpf_hash TEXT NOT NULL, cpf_mask TEXT NOT NULL, phone TEXT NOT NULL, terms_accepted_at TEXT NOT NULL,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, access_group_key TEXT NOT NULL DEFAULT 'primary',
  amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'BRL', status TEXT NOT NULL DEFAULT 'pending',
  provider_payment_id TEXT UNIQUE, provider_status TEXT, pix_code TEXT, pix_qr_base64 TEXT, approved_at TEXT,
  redeem_token_hash TEXT UNIQUE, redeem_expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_events (
  provider TEXT NOT NULL, event_key TEXT NOT NULL, received_at TEXT NOT NULL, processed_at TEXT,
  result TEXT, PRIMARY KEY(provider, event_key)
);
CREATE TABLE IF NOT EXISTS invite_history (
  id TEXT PRIMARY KEY, invite_url TEXT, changed_at TEXT NOT NULL, changed_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_jobs (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, recipient TEXT NOT NULL, subject TEXT NOT NULL,
  body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL, last_error TEXT, sent_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS store_offers (
  id TEXT PRIMARY KEY, access_group_key TEXT NOT NULL DEFAULT 'primary', exact_name TEXT NOT NULL,
  price_cents INTEGER NOT NULL, real_image_path TEXT, selected_image_url TEXT,
  image_is_illustrative INTEGER NOT NULL DEFAULT 0, model_identified TEXT, confidence DOUBLE PRECISION,
  caption TEXT, research_json TEXT, status TEXT NOT NULL, failure_reason TEXT,
  publish_attempts INTEGER NOT NULL DEFAULT 0, published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sent_products (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, affiliate_link TEXT NOT NULL, niche TEXT, asin TEXT,
  title_hash TEXT, sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS groups (
  id BIGSERIAL PRIMARY KEY, niche TEXT NOT NULL, platform TEXT NOT NULL, target_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS whatsapp_queue (
  id BIGSERIAL PRIMARY KEY, product_name TEXT NOT NULL, message TEXT NOT NULL, niche TEXT NOT NULL,
  image_url TEXT, status TEXT DEFAULT 'pending', retries INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS niches (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT, target_audience TEXT,
  allowed_product_types TEXT, tone TEXT, default_cta TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, niche TEXT, old_price DOUBLE PRECISION, current_price DOUBLE PRECISION,
  discount_pct DOUBLE PRECISION, image_url TEXT, affiliate_url TEXT, source TEXT, score DOUBLE PRECISION,
  status TEXT DEFAULT 'new', metadata_json TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS creative_variants (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL, campaign_id TEXT, angle TEXT, hook TEXT, script TEXT,
  on_screen_text_json TEXT, caption TEXT, hashtags_json TEXT, cta TEXT, video_path TEXT, audio_path TEXT,
  status TEXT DEFAULT 'draft', quality_status TEXT, quality_score DOUBLE PRECISION, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS social_accounts (
  id TEXT PRIMARY KEY, platform TEXT NOT NULL, handle TEXT NOT NULL, niche TEXT, display_name TEXT,
  status TEXT DEFAULT 'active', daily_limit INTEGER DEFAULT 2, style_prompt TEXT, default_cta TEXT,
  posting_mode TEXT DEFAULT 'manual', access_token_encrypted TEXT, refresh_token_encrypted TEXT,
  token_expires_at TEXT, metadata_json TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS publish_queue (
  id TEXT PRIMARY KEY, creative_id TEXT NOT NULL, product_id TEXT, account_id TEXT NOT NULL, scheduled_at TEXT,
  caption TEXT, status TEXT DEFAULT 'draft', error_message TEXT, quality_review_id TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS published_posts (
  id TEXT PRIMARY KEY, creative_id TEXT, product_id TEXT, account_id TEXT, platform TEXT, platform_post_id TEXT,
  public_url TEXT, tracking_code TEXT, status TEXT, published_at TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS tracking_events (
  id TEXT PRIMARY KEY, tracking_code TEXT, event_type TEXT, source TEXT, account_id TEXT, product_id TEXT,
  creative_id TEXT, metadata_json TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS creative_quality_reviews (
  id TEXT PRIMARY KEY, creative_id TEXT, account_id TEXT, hook_score DOUBLE PRECISION,
  utility_score DOUBLE PRECISION, clarity_score DOUBLE PRECISION, originality_score DOUBLE PRECISION,
  honesty_score DOUBLE PRECISION, niche_fit_score DOUBLE PRECISION, cta_score DOUBLE PRECISION,
  spam_risk_score DOUBLE PRECISION, retention_score DOUBLE PRECISION, final_score DOUBLE PRECISION,
  status TEXT, problems_json TEXT, improvements_json TEXT, rewrite TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS post_similarity_records (
  id TEXT PRIMARY KEY, creative_id TEXT, account_id TEXT, script_hash TEXT, caption_hash TEXT,
  product_id TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_customer_status ON orders(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_email_jobs_status ON email_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_store_offers_status ON store_offers(status, created_at);
CREATE INDEX IF NOT EXISTS idx_wa_queue_status ON whatsapp_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sent_products_asin_niche ON sent_products(asin, niche);
CREATE INDEX IF NOT EXISTS idx_sent_products_title_hash_niche ON sent_products(title_hash, niche);
CREATE INDEX IF NOT EXISTS idx_products_niche_status ON products(niche, status, score);
CREATE INDEX IF NOT EXISTS idx_publish_queue_status ON publish_queue(status, scheduled_at);
`;

async function initDb() {
  await db.query(schema);
  await db.query(`INSERT INTO commerce_settings
    (id, access_name, access_description, sales_status, email_subject, email_body, updated_at)
    VALUES (1, 'Grupo privado Garimpo da Madame', 'Curadoria de achados e alertas de produtos disponíveis.', 'paused',
      'Seu acesso ao Garimpo da Madame foi liberado',
      'Olá, {{nome}}! Seu pagamento foi confirmado. Abra sua página segura para acessar o convite: {{link_acesso}}\\n\\nDúvidas: {{suporte}}',
      CURRENT_TIMESTAMP::text)
    ON CONFLICT (id) DO NOTHING`);
  console.log('[PostgreSQL] Inicialização completa.');
}

async function safeAddColumn(table, column, definition) {
  const allowed = new Set(['customers.cpf_mask', 'orders.access_group_key', 'store_offers.access_group_key']);
  if (!allowed.has(`${table}.${column}`)) throw new Error('Migração não permitida.');
  await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
  return true;
}

const ready = initDb().catch(error => {
  console.error('[PostgreSQL] Falha na inicialização:', error.message);
  throw error;
});

module.exports = { db, runQuery, getQuery, ready, safeAddColumn, dbPath: 'postgresql' };
module.exports._test = { placeholders, portableSql };
