const express = require('express');
const nichesStore = require('./niches-store');

function createNichesRoutes() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    res.json({ niches: await nichesStore.listNiches() });
  });

  router.get('/:slug', async (req, res) => {
    const niche = await nichesStore.getNicheBySlug(req.params.slug);
    if (!niche) return res.status(404).json({ error: 'nicho nao encontrado' });
    res.json(niche);
  });

  router.post('/', async (req, res) => {
    try {
      res.status(201).json(await nichesStore.createNiche(req.body));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.patch('/:id', async (req, res) => {
    try {
      const niche = await nichesStore.updateNiche(req.params.id, req.body);
      if (!niche) return res.status(404).json({ error: 'nicho nao encontrado' });
      res.json(niche);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    await nichesStore.deleteNiche(req.params.id);
    res.json({ success: true });
  });

  return router;
}

module.exports = createNichesRoutes;
