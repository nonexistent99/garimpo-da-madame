const express = require('express');
const creativesStore = require('./creatives-store');
const creativeGenerator = require('./creative-generator');
const contentQuality = require('../content-quality/content-quality');

function createCreativesRoutes() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    res.json({ creatives: await creativesStore.listCreatives(req.query) });
  });

  router.get('/:id', async (req, res) => {
    const creative = await creativesStore.getCreative(req.params.id);
    if (!creative) return res.status(404).json({ error: 'criativo nao encontrado' });
    res.json(creative);
  });

  router.patch('/:id', async (req, res) => {
    const creative = await creativesStore.updateCreative(req.params.id, req.body);
    if (!creative) return res.status(404).json({ error: 'criativo nao encontrado' });
    res.json(creative);
  });

  router.post('/:id/render', async (req, res) => {
    try {
      res.json(await creativeGenerator.renderCreative(req.params.id));
    } catch (error) {
      await creativesStore.updateCreative(req.params.id, { status: 'ready_to_render' }).catch(() => null);
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/:id/approve', async (req, res) => {
    const creative = await creativesStore.setCreativeStatus(req.params.id, 'approved');
    if (!creative) return res.status(404).json({ error: 'criativo nao encontrado' });
    res.json(creative);
  });

  router.post('/:id/reject', async (req, res) => {
    const creative = await creativesStore.setCreativeStatus(req.params.id, 'rejected');
    if (!creative) return res.status(404).json({ error: 'criativo nao encontrado' });
    res.json(creative);
  });

  router.post('/:id/improve', async (req, res) => {
    const creative = await creativesStore.getCreative(req.params.id);
    if (!creative) return res.status(404).json({ error: 'criativo nao encontrado' });
    const improved = contentQuality.improveCreative({
      product: req.body.product || {},
      niche: req.body.niche || {},
      account: req.body.account || {},
      creative,
    });
    res.json(await creativesStore.updateCreative(req.params.id, improved));
  });

  return router;
}

module.exports = createCreativesRoutes;
