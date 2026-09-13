const express = require('express');
const queueStore = require('./publish-queue-store');
const publisherEngine = require('./publisher-engine');

function createPublisherRoutes() {
  const router = express.Router();

  router.post('/queue', async (req, res) => {
    try {
      const result = await publisherEngine.createQueueItem(req.body);
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ error: error.message, details: error.details || null });
    }
  });

  router.get('/queue', async (req, res) => {
    res.json({ queue: await queueStore.listQueue(req.query) });
  });

  router.patch('/queue/:id', async (req, res) => {
    const item = await queueStore.updateQueueItem(req.params.id, req.body);
    if (!item) return res.status(404).json({ error: 'item nao encontrado' });
    res.json(item);
  });

  router.post('/queue/:id/approve', async (req, res) => {
    try {
      res.json(await publisherEngine.approveQueueItem(req.params.id));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/queue/:id/publish-now', async (req, res) => {
    try {
      res.json(await publisherEngine.publishQueueItem(req.params.id));
    } catch (error) {
      res.status(400).json({ error: error.message, details: error.details || null });
    }
  });

  router.post('/queue/:id/cancel', async (req, res) => {
    res.json(await publisherEngine.cancelQueueItem(req.params.id));
  });

  router.post('/export', async (req, res) => {
    try {
      res.json(await publisherEngine.exportNow(req.body));
    } catch (error) {
      res.status(400).json({ error: error.message, details: error.details || null });
    }
  });

  return router;
}

module.exports = createPublisherRoutes;
