const express = require('express');
const cors = require('cors');
const db = require('./database/database');
const { queueProduct, runJobs } = require('./jobs/offerJob');
const { getPendingWhatsAppMessages, markWhatsAppMessageAsSent } = require('./services/whatsappQueueService');
const { scrapeLink } = require('./services/scraperService');
const registerOffersWorkspace = require('../modules/offers-workspace');
const { registerCommerceRoutes } = require('./commerce/routes');
const { requireAdmin } = require('./commerce/security');

const path = require('path');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors({ origin: false }));
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' https://www.googletagmanager.com; connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com; frame-src 'self'; base-uri 'none'; form-action 'self'");
  next();
});

registerCommerceRoutes(app);

// Desabilita cache nos assets estáticos para evitar HTML/JS desatualizado
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.use(express.static(path.join(__dirname, '../public'), {
  etag: false,
  lastModified: false,
  maxAge: 0,
}));

app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));
app.get('/consulta', (_req, res) => res.sendFile(path.join(__dirname, '../public/consulta.html')));
app.get('/resgate/:token', (_req, res) => res.sendFile(path.join(__dirname, '../public/redeem.html')));

// GET /health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/health', async (_req, res) => {
  try {
    await db.ready;
    await db.getQuery('SELECT 1 AS ok');
    const commit = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.COMMIT_REF || null;
    res.json({
      status: 'ok',
      database: process.env.DATABASE_URL ? 'postgresql' : 'sqlite',
      release: {
        commit: commit ? commit.slice(0, 12) : null,
        capabilities: ['admin-realtime', 'order-email-recovery']
      }
    });
  } catch (_error) {
    res.status(503).json({ status: 'unavailable' });
  }
});

// Tudo abaixo deste ponto é operacional. A landing, checkout, resgate e webhook
// foram registrados acima; APIs novas e legadas exigem sessão administrativa.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || ['/offers', '/groups', '/quick-offer', '/run-now', '/whatsapp-queue', '/mark-whatsapp-sent'].includes(req.path)) {
    return requireAdmin(req, res, next);
  }
  next();
});

// POST /offers - Receber oferta manualmente
app.post('/offers', (req, res) => {
  const product = req.body;
  
  if (queueProduct(product)) {
    res.status(202).json({ message: 'Oferta adicionada à fila de processamento.' });
  } else {
    res.status(400).json({ error: 'Dados da oferta inválidos.' });
  }
});

// POST /quick-offer - Receber apenas o link e raspar os dados
app.post('/quick-offer', async (req, res) => {
  const { link } = req.body;
  
  if (!link) {
    return res.status(400).json({ error: 'Link é obrigatório.' });
  }
  
  try {
    const product = await scrapeLink(link);
    
    if (queueProduct(product)) {
      res.status(202).json({ 
        message: 'Oferta extraída e adicionada à fila.',
        product: product 
      });
    } else {
      res.status(400).json({ error: 'Falha ao validar os dados extraídos.' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /offers - Listar produtos enviados
app.get('/offers', async (req, res) => {
  try {
    const products = await db.getQuery('SELECT * FROM sent_products ORDER BY sent_at DESC LIMIT 50');
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar ofertas.' });
  }
});

// GET /groups - Listar grupos
app.get('/groups', async (req, res) => {
  try {
    const groups = await db.getQuery('SELECT * FROM groups');
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar grupos.' });
  }
});

// POST /groups - Cadastrar grupo (upsert por niche+platform)
app.post('/groups', async (req, res) => {
  const { niche, platform, target_id } = req.body;

  if (!niche || !platform || !target_id) {
    return res.status(400).json({ error: 'niche, platform e target_id são obrigatórios.' });
  }

  if (!['telegram', 'whatsapp'].includes(platform)) {
    return res.status(400).json({ error: 'Platform deve ser telegram ou whatsapp.' });
  }

  try {
    // Verifica se já existe esse nicho+plataforma. Se sim, atualiza.
    const existing = await db.getQuery(
      'SELECT id FROM groups WHERE niche = ? AND platform = ?',
      [niche, platform]
    );

    if (existing.length > 0) {
      await db.runQuery(
        'UPDATE groups SET target_id = ? WHERE id = ?',
        [target_id, existing[0].id]
      );
      return res.json({ message: 'Grupo atualizado.', id: existing[0].id });
    }

    const result = await db.runQuery(
      'INSERT INTO groups (niche, platform, target_id) VALUES (?, ?, ?)',
      [niche, platform, target_id]
    );
    res.status(201).json({ message: 'Grupo cadastrado.', id: result.lastID });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar grupo: ' + error.message });
  }
});

// PUT /groups/:id - Atualizar grupo
app.put('/groups/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { niche, platform, target_id } = req.body;

  if (!id || (!niche && !platform && !target_id)) {
    return res.status(400).json({ error: 'ID e ao menos um campo são obrigatórios.' });
  }

  try {
    const sets = [];
    const params = [];
    if (niche) { sets.push('niche = ?'); params.push(niche); }
    if (platform) { sets.push('platform = ?'); params.push(platform); }
    if (target_id) { sets.push('target_id = ?'); params.push(target_id); }
    params.push(id);

    await db.runQuery(`UPDATE groups SET ${sets.join(', ')} WHERE id = ?`, params);
    res.json({ message: 'Grupo atualizado com sucesso.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar grupo.' });
  }
});

// DELETE /groups/:id - Remover grupo
app.delete('/groups/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido.' });

  try {
    await db.runQuery('DELETE FROM groups WHERE id = ?', [id]);
    res.json({ message: 'Grupo removido.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao remover grupo.' });
  }
});

// GET /whatsapp-queue/stats - Estatísticas agregadas da fila WhatsApp por status/nicho
app.get('/whatsapp-queue/stats', async (req, res) => {
  try {
    const byStatus = await db.getQuery(
      'SELECT status, COUNT(*) as count FROM whatsapp_queue GROUP BY status'
    );
    const byNiche = await db.getQuery(
      "SELECT niche, COUNT(*) as count FROM whatsapp_queue WHERE status = 'pending' GROUP BY niche"
    );
    res.json({ byStatus, byNiche });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar stats.' });
  }
});

// GET /sent-products/stats - Quantidade de produtos enviados por nicho
app.get('/sent-products/stats', async (req, res) => {
  try {
    const rows = await db.getQuery(
      'SELECT niche, COUNT(*) as count FROM sent_products GROUP BY niche ORDER BY count DESC'
    );
    res.json({ stats: rows });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar estatísticas.' });
  }
});

// GET /sent-products/by-category - Histórico de enviados agrupado por categoria
app.get('/sent-products/by-category', async (req, res) => {
  try {
    const rows = await db.getQuery(
      'SELECT id, name, affiliate_link, niche, sent_at FROM sent_products ORDER BY sent_at DESC LIMIT 500'
    );
    const grouped = {};
    for (const r of rows) {
      const cat = r.niche || 'Sem Categoria';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(r);
    }
    res.json({ grouped });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar histórico.' });
  }
});

// GET /whatsapp-queue/by-category - Fila WhatsApp pendente agrupada por categoria
app.get('/whatsapp-queue/by-category', async (req, res) => {
  try {
    const rows = await db.getQuery(
      "SELECT id, product_name, message, niche, image_url, status, created_at FROM whatsapp_queue WHERE status IN ('pending', 'sent') ORDER BY created_at DESC LIMIT 500"
    );
    const grouped = {};
    for (const r of rows) {
      const cat = r.niche || 'Sem Categoria';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(r);
    }
    res.json({ grouped });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar fila.' });
  }
});

// POST /run-now - Rodar job manualmente lendo de JSON/CSV
app.post('/run-now', (req, res) => {
  runJobs();
  res.json({ message: 'Processamento de arquivos (JSON/CSV) iniciado em background.' });
});

// GET /whatsapp-queue - Fila de WhatsApp
app.get('/whatsapp-queue', async (req, res) => {
  try {
    const messages = await getPendingWhatsAppMessages();
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar fila do WhatsApp.' });
  }
});

// POST /mark-whatsapp-sent - Marcar msg WhatsApp como enviada
app.post('/mark-whatsapp-sent', async (req, res) => {
  const { id } = req.body;
  
  if (!id) {
    return res.status(400).json({ error: 'ID é obrigatório.' });
  }
  
  try {
    const success = await markWhatsAppMessageAsSent(id);
    if (success) {
      res.json({ message: `Mensagem ${id} marcada como enviada.` });
    } else {
      res.status(500).json({ error: 'Erro ao atualizar mensagem.' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// Offers Workspace modules are additive: products, creatives, accounts, publisher, tracking and analytics.
registerOffersWorkspace(app);

module.exports = app;
