const express = require('express');
const contentQuality = require('./content-quality');

function createContentQualityRoutes() {
  const router = express.Router();

  router.post('/evaluate', async (req, res) => {
    try {
      const evaluation = await contentQuality.evaluateByIds({
        creative_id: req.body.creative_id,
        account_id: req.body.account_id,
      });
      res.json({
        final_score: evaluation.final_score,
        status: evaluation.status,
        problems: evaluation.problems,
        improvements: evaluation.improvements,
        rewrite: evaluation.rewrite,
        review_id: evaluation.review_id,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}

module.exports = createContentQualityRoutes;
