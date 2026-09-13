const express = require('express');
const tracking = require('./tracking-engine');

function createTrackingRoutes() {
  const router = express.Router();

  router.post('/api/tracking/manual-event', async (req, res) => {
    try {
      const event = await tracking.registerEvent({
        trackingCode: req.body.tracking_code,
        eventType: req.body.event_type || 'manual_mark',
        metadata: req.body.metadata || {},
      });
      res.json(event);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/r/:tracking_code', async (req, res) => {
    const trackingCode = req.params.tracking_code;
    const target = await tracking.resolveRedirectTarget(trackingCode);
    await tracking.registerEvent({
      trackingCode,
      eventType: 'click',
      source: req.get('referer') || null,
      accountId: target && target.account_id,
      productId: target && target.product_id,
      creativeId: target && target.creative_id,
      metadata: {
        userAgent: req.get('user-agent') || null,
        ip: req.ip,
      },
    });

    if (!target || !target.targetUrl) {
      return res.status(404).send('Link de oferta indisponivel ou expirado.');
    }
    res.redirect(target.targetUrl);
  });

  return router;
}

module.exports = createTrackingRoutes;
