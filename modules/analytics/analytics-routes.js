const express = require('express');
const db = require('../../src/database/database');

async function one(sql, params = []) {
  const rows = await db.getQuery(sql, params);
  return rows[0] || {};
}

function createAnalyticsRoutes() {
  const router = express.Router();

  router.get('/summary', async (req, res) => {
    await db.ready;
    const totalProducts = await one('SELECT COUNT(*) AS count FROM products');
    const totalCreatives = await one('SELECT COUNT(*) AS count FROM creative_variants');
    const totalPosts = await one('SELECT COUNT(*) AS count FROM published_posts');
    const totalClicks = await one("SELECT COUNT(*) AS count FROM tracking_events WHERE event_type = 'click'");
    const blocked = await one("SELECT COUNT(*) AS count FROM creative_quality_reviews WHERE status = 'blocked'");
    const needsRevision = await one("SELECT COUNT(*) AS count FROM creative_quality_reviews WHERE status = 'needs_revision'");

    const clicksByNiche = await db.getQuery(
      `SELECT p.niche, COUNT(te.id) AS clicks
       FROM tracking_events te
       JOIN products p ON p.id = te.product_id
       WHERE te.event_type = 'click'
       GROUP BY p.niche ORDER BY clicks DESC`
    );
    const clicksByAccount = await db.getQuery(
      `SELECT a.handle, a.platform, COUNT(te.id) AS clicks
       FROM tracking_events te
       JOIN social_accounts a ON a.id = te.account_id
       WHERE te.event_type = 'click'
       GROUP BY a.id ORDER BY clicks DESC`
    );
    const clicksByProduct = await db.getQuery(
      `SELECT p.id, p.name, COUNT(te.id) AS clicks
       FROM tracking_events te
       JOIN products p ON p.id = te.product_id
       WHERE te.event_type = 'click'
       GROUP BY p.id ORDER BY clicks DESC LIMIT 10`
    );
    const topCreatives = await db.getQuery(
      `SELECT c.id, c.hook, c.quality_score, COUNT(te.id) AS clicks
       FROM creative_variants c
       LEFT JOIN tracking_events te ON te.creative_id = c.id
       GROUP BY c.id ORDER BY clicks DESC, c.quality_score DESC LIMIT 10`
    );

    res.json({
      total_products: totalProducts.count || 0,
      total_creatives: totalCreatives.count || 0,
      total_posts: totalPosts.count || 0,
      total_clicks: totalClicks.count || 0,
      clicks_by_niche: clicksByNiche,
      clicks_by_account: clicksByAccount,
      clicks_by_product: clicksByProduct,
      top_creatives: topCreatives,
      blocked_low_value_count: blocked.count || 0,
      needs_revision_count: needsRevision.count || 0,
    });
  });

  router.get('/accounts', async (req, res) => {
    await db.ready;
    res.json({ accounts: await db.getQuery(`
      SELECT a.id, a.handle, a.platform, a.niche, COUNT(pp.id) AS posts, COUNT(te.id) AS clicks
      FROM social_accounts a
      LEFT JOIN published_posts pp ON pp.account_id = a.id
      LEFT JOIN tracking_events te ON te.account_id = a.id
      GROUP BY a.id ORDER BY clicks DESC
    `) });
  });

  router.get('/products', async (req, res) => {
    await db.ready;
    res.json({ products: await db.getQuery(`
      SELECT p.id, p.name, p.niche, p.score, COUNT(pp.id) AS posts, COUNT(te.id) AS clicks
      FROM products p
      LEFT JOIN published_posts pp ON pp.product_id = p.id
      LEFT JOIN tracking_events te ON te.product_id = p.id
      GROUP BY p.id ORDER BY clicks DESC, p.score DESC
    `) });
  });

  router.get('/creatives', async (req, res) => {
    await db.ready;
    res.json({ creatives: await db.getQuery(`
      SELECT c.id, c.product_id, c.hook, c.status, c.quality_status, c.quality_score, COUNT(te.id) AS clicks
      FROM creative_variants c
      LEFT JOIN tracking_events te ON te.creative_id = c.id
      GROUP BY c.id ORDER BY clicks DESC, c.quality_score DESC
    `) });
  });

  router.get('/niches', async (req, res) => {
    await db.ready;
    res.json({ niches: await db.getQuery(`
      SELECT p.niche, COUNT(DISTINCT p.id) AS products, COUNT(DISTINCT c.id) AS creatives, COUNT(te.id) AS clicks
      FROM products p
      LEFT JOIN creative_variants c ON c.product_id = p.id
      LEFT JOIN tracking_events te ON te.product_id = p.id
      GROUP BY p.niche ORDER BY clicks DESC
    `) });
  });

  return router;
}

module.exports = createAnalyticsRoutes;
