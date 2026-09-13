const express = require('express');
const accountsStore = require('./accounts-store');

function createAccountsRoutes() {
  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      res.status(201).json(await accountsStore.createAccount(req.body));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/', async (req, res) => {
    res.json({ accounts: await accountsStore.listAccounts(req.query) });
  });

  router.get('/:id', async (req, res) => {
    const account = await accountsStore.getAccount(req.params.id);
    if (!account) return res.status(404).json({ error: 'conta nao encontrada' });
    res.json(account);
  });

  router.patch('/:id', async (req, res) => {
    try {
      const account = await accountsStore.updateAccount(req.params.id, req.body);
      if (!account) return res.status(404).json({ error: 'conta nao encontrada' });
      res.json(account);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    await accountsStore.deleteAccount(req.params.id);
    res.json({ success: true });
  });

  return router;
}

module.exports = createAccountsRoutes;
