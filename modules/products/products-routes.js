const express = require('express');
const productsStore = require('./products-store');
const creativeGenerator = require('../creatives/creative-generator');

function createProductsRoutes() {
  const router = express.Router();

  router.post('/import', async (req, res) => {
    try {
      const product = await productsStore.createProduct(req.body);
      res.status(201).json(product);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const products = await productsStore.listProducts(req.query);
      res.json({ products });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/top', async (req, res) => {
    try {
      const products = await productsStore.getTopProducts(req.query);
      res.json({ products });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/:id', async (req, res) => {
    const product = await productsStore.getProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'produto nao encontrado' });
    res.json(product);
  });

  router.patch('/:id/status', async (req, res) => {
    try {
      const product = await productsStore.updateProductStatus(req.params.id, req.body.status);
      if (!product) return res.status(404).json({ error: 'produto nao encontrado' });
      res.json(product);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/:id/generate-campaign', async (req, res) => {
    try {
      const result = await creativeGenerator.generateCampaignForProduct(req.params.id, req.body || {});
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}

module.exports = createProductsRoutes;
