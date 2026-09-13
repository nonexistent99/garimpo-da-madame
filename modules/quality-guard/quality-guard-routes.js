const express = require('express');
const qualityGuard = require('./quality-guard');

function createQualityGuardRoutes() {
  const router = express.Router();

  router.post('/check', async (req, res) => {
    try {
      const result = await qualityGuard.runQualityGuardByIds({
        creative_id: req.body.creative_id,
        account_id: req.body.account_id,
        scheduled_at: req.body.scheduled_at,
        caption: req.body.caption,
        ignore_queue_id: req.body.ignore_queue_id,
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}

module.exports = createQualityGuardRoutes;
