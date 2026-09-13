document.addEventListener('DOMContentLoaded', () => {
  const API_URL = '';

  // ─── Helpers ────────────────────────────────────────────────────────────────
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtBRL(val) {
    const n = parseFloat(val);
    if (isNaN(n) || n <= 0) return '—';
    return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    const colorMap = { success: 'var(--primary)', error: 'var(--danger)', warning: 'var(--warning)' };
    toast.style.backgroundColor = colorMap[type] || colorMap.success;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  async function jget(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ─── Navegação ──────────────────────────────────────────────────────────────
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      tabContents.forEach(t => t.classList.remove('active'));
      item.classList.add('active');
      const tabId = item.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');

      if (tabId === 'dashboard') refreshAll();
      if (tabId === 'whatsapp') loadWhatsAppQueue();
      if (tabId === 'whatsapp-conn') { reloadQrFrame(); refreshWhatsAppStatus(); loadLiveGroups(); loadSessionInfo(); }
      if (tabId === 'products') loadProductsByCategory();
      if (tabId === 'settings') loadGroups();
    });
  });

  // ─── WhatsApp status pill ───────────────────────────────────────────────────
  async function refreshWhatsAppStatus() {
    try {
      const data = await jget(`${API_URL}/api/whatsapp/status`);
      updateConnectionPill(data.status);
      updateStatBox(data.status);
    } catch (err) {
      updateConnectionPill('error');
      updateStatBox('error');
    }
  }

  function updateConnectionPill(status) {
    const pill = document.getElementById('connectionPill');
    if (!pill) return;
    pill.classList.remove('is-connected', 'is-qr', 'is-down');
    const label = pill.querySelector('.label');
    if (status === 'connected') { pill.classList.add('is-connected'); label.textContent = 'WhatsApp conectado'; }
    else if (status === 'qr_ready') { pill.classList.add('is-qr'); label.textContent = 'Aguardando QR scan'; }
    else if (status === 'disconnected') { pill.classList.add('is-down'); label.textContent = 'Iniciando...'; }
    else { pill.classList.add('is-down'); label.textContent = 'Sem conexão com servidor'; }
  }

  function updateStatBox(status) {
    const el = document.getElementById('statWAStatus');
    if (!el) return;
    if (status === 'connected') el.innerHTML = '<span style="color:var(--success)">● Conectado</span>';
    else if (status === 'qr_ready') el.innerHTML = '<span style="color:var(--warning)">● QR pronto</span>';
    else if (status === 'disconnected') el.innerHTML = '<span style="color:var(--warning)">● Iniciando</span>';
    else el.innerHTML = '<span style="color:var(--danger)">● Servidor offline</span>';
  }

  function reloadQrFrame() {
    const frame = document.getElementById('qrFrame');
    if (!frame) return;
    frame.src = `/api/whatsapp/qr?t=${Date.now()}`;
  }

  async function loadSessionInfo() {
    const box = document.getElementById('sessionInfoBox');
    if (!box) return;
    try {
      const info = await jget(`${API_URL}/api/whatsapp/session-info`);
      const statusEmoji = info.status === 'connected' ? '🟢' : info.status === 'qr_ready' ? '🟡' : '🔴';
      const credsStatus = info.hasCreds
        ? `<span style="color:var(--success)">✅ Sim</span>`
        : `<span style="color:var(--warning)">❌ Não (precisa escanear QR)</span>`;
      const lastConn = info.lastConnectedAt ? new Date(info.lastConnectedAt).toLocaleString('pt-BR') : '—';
      const credsDate = info.credsModified ? new Date(info.credsModified).toLocaleString('pt-BR') : '—';
      const disconnect = info.lastDisconnectReason ? `<div>Última falha: <span style="color:var(--warning)">${escapeHtml(info.lastDisconnectReason)}</span></div>` : '';
      box.innerHTML = `
        <div>Status: ${statusEmoji} <strong>${escapeHtml(info.status)}</strong></div>
        <div>Sessão salva: ${credsStatus}</div>
        <div>Arquivos auth: <strong>${info.totalFiles}</strong></div>
        <div>Credenciais modificadas: ${escapeHtml(credsDate)}</div>
        <div>Último connect: ${escapeHtml(lastConn)}</div>
        <div>Tentativas reconexão: <strong>${info.reconnectAttempts || 0}</strong></div>
        ${disconnect}
        <div style="word-break:break-all;margin-top:.3rem;color:var(--text-muted);font-size:.7rem">📁 ${escapeHtml(info.folder)}</div>
      `;
    } catch (e) {
      box.innerHTML = `<span style="color:var(--danger)">Erro ao carregar info da sessão.</span>`;
    }
  }

  async function loadLiveGroups() {
    const box = document.getElementById('liveGroupsList');
    if (!box) return;
    try {
      const res = await fetch(`${API_URL}/api/whatsapp/groups`);
      if (!res.ok) {
        const err = await res.json();
        box.innerHTML = `<p style="color:var(--warning);text-align:center;padding:1rem">${escapeHtml(err.error || 'Conecte primeiro.')}</p>`;
        return;
      }
      const data = await res.json();
      const groups = data.groups || [];
      if (groups.length === 0) {
        box.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem">Nenhum grupo encontrado.</p>';
        return;
      }
      box.innerHTML = groups.map(g => `
        <div style="padding:.4rem .3rem;border-bottom:1px solid rgba(255,255,255,.05)">
          <div style="color:var(--text-main);font-weight:600">${escapeHtml(g.name)}</div>
          <div style="font-size:.75rem;color:var(--text-muted);user-select:all">${escapeHtml(g.id)}</div>
        </div>
      `).join('');
    } catch (e) {
      box.innerHTML = `<p style="color:var(--danger);text-align:center;padding:1rem">Erro de rede.</p>`;
    }
  }

  // ─── Dashboard ──────────────────────────────────────────────────────────────
  async function loadDashboard() {
    try {
      const data = await jget(`${API_URL}/offers`);
      document.getElementById('statSent').textContent = data.length;
      const tbody = document.getElementById('sentProductsBody');
      tbody.innerHTML = '';
      data.forEach(item => {
        const date = item.sent_at ? new Date(item.sent_at).toLocaleString('pt-BR') : '—';
        tbody.insertAdjacentHTML('beforeend', `
          <tr>
            <td>#${item.id}</td>
            <td><strong>${escapeHtml(item.name)}</strong></td>
            <td><span class="chip" style="background: rgba(99,102,241,0.2); color: #a5b4fc; padding: 2px 10px; border-radius: 12px; font-size: 12px;">${escapeHtml(item.niche)}</span></td>
            <td>${date}</td>
          </tr>
        `);
      });
    } catch (err) { console.error('Erro dashboard', err); }
  }

  async function loadQueuesStatus() {
    try {
      const data = await jget(`${API_URL}/api/queues-status`);
      document.getElementById('statRam').textContent = data.total || 0;
      const container = document.getElementById('queuesByNiche');
      container.innerHTML = '';
      for (const [niche, count] of Object.entries(data.queues)) {
        const cls = count > 0 ? 'has' : 'empty';
        container.insertAdjacentHTML('beforeend', `
          <div class="niche-card ${cls}">
            <span class="niche-name">${escapeHtml(niche)}</span>
            <span class="niche-count">${count}</span>
          </div>
        `);
      }
    } catch (err) { console.error('Erro queues-status', err); }
  }

  // ─── Produtos por Categoria ────────────────────────────────────────────────
  let currentProductFilter = 'ram';

  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentProductFilter = tab.getAttribute('data-filter');
      loadProductsByCategory();
    });
  });

  async function loadProductsByCategory() {
    const container = document.getElementById('productsCategoriesContainer');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:3rem">Carregando produtos...</p>';

    try {
      let grouped = {};
      let renderMode = 'ram';

      if (currentProductFilter === 'ram') {
        const data = await jget(`${API_URL}/api/queues-detailed`);
        grouped = data.queues || {};
        renderMode = 'ram';
      } else if (currentProductFilter === 'sent') {
        const data = await jget(`${API_URL}/sent-products/by-category`);
        grouped = data.grouped || {};
        renderMode = 'sent';
      } else if (currentProductFilter === 'queue') {
        const data = await jget(`${API_URL}/whatsapp-queue/by-category`);
        grouped = data.grouped || {};
        renderMode = 'queue';
      }

      renderCategoryBlocks(grouped, renderMode);
    } catch (err) {
      container.innerHTML = `<p class="empty-state" style="color:var(--danger)">Erro ao carregar: ${escapeHtml(err.message)}</p>`;
    }
  }

  function renderCategoryBlocks(grouped, mode) {
    const container = document.getElementById('productsCategoriesContainer');
    container.innerHTML = '';

    const entries = Object.entries(grouped).filter(([, items]) => items && items.length > 0);

    if (entries.length === 0) {
      let msg = 'Nenhum produto disponível ainda.';
      if (mode === 'ram') msg = 'Nenhum produto nas gavetas RAM no momento. Clique em "Garimpar Agora" ou aguarde o próximo ciclo de scraping (3 min).';
      if (mode === 'sent') msg = 'Nenhuma oferta enviada ainda. Quando o bot disparar a primeira, ela aparecerá aqui.';
      if (mode === 'queue') msg = 'Nenhuma mensagem na fila do WhatsApp.';
      container.innerHTML = `<div class="card glass"><p class="empty-state">${msg}</p></div>`;
      return;
    }

    entries
      .sort((a, b) => b[1].length - a[1].length)
      .forEach(([category, items]) => {
        const block = document.createElement('div');
        block.className = 'category-block';
        block.innerHTML = `
          <div class="category-header">
            <h3>
              <span>📦 ${escapeHtml(category)}</span>
              <span class="badge-count">${items.length}</span>
            </h3>
            <span class="toggle-icon">▼</span>
          </div>
          <div class="category-body">
            ${items.map(p => renderProductCard(p, mode)).join('')}
          </div>
        `;
        block.querySelector('.category-header').addEventListener('click', () => {
          block.classList.toggle('collapsed');
        });
        container.appendChild(block);
      });
  }

  function renderProductCard(p, mode) {
    if (mode === 'ram') {
      const hasImg = p.image ? `<img class="product-thumb" src="${escapeHtml(p.image)}" alt="" onerror="this.style.display='none'">` : '';
      const discount = p.discount ? `<span class="product-discount">-${p.discount}%</span>` : '';
      const priceOld = (p.oldPrice && p.oldPrice > p.currentPrice) ? `<span class="price-old">${fmtBRL(p.oldPrice)}</span>` : '';
      const priceCurrent = `<span class="price-current">${fmtBRL(p.currentPrice)}</span>`;
      return `
        <div class="product-card">
          ${hasImg}
          <div class="product-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
          <div class="product-prices">${priceOld}${priceCurrent}</div>
          ${discount}
          <div class="product-meta">
            <span>${escapeHtml(p.keywordSource || '—')}</span>
            <span>★ ${p.score || 0}</span>
          </div>
          <a class="product-link" href="${escapeHtml(p.affiliateLink)}" target="_blank" rel="noopener">Ver no marketplace</a>
        </div>
      `;
    }

    if (mode === 'sent') {
      const date = p.sent_at ? new Date(p.sent_at).toLocaleString('pt-BR') : '—';
      return `
        <div class="product-card">
          <div class="product-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
          <div class="product-meta">
            <span>#${p.id}</span>
            <span>${date}</span>
          </div>
          <a class="product-link" href="${escapeHtml(p.affiliate_link)}" target="_blank" rel="noopener">Abrir link</a>
        </div>
      `;
    }

    if (mode === 'queue') {
      const date = p.created_at ? new Date(p.created_at).toLocaleString('pt-BR') : '—';
      const statusColor = p.status === 'sent' ? 'var(--success)' : (p.status === 'pending' ? 'var(--warning)' : 'var(--text-muted)');
      const hasImg = p.image_url ? `<img class="product-thumb" src="${escapeHtml(p.image_url)}" alt="" onerror="this.style.display='none'">` : '';
      return `
        <div class="product-card">
          ${hasImg}
          <div class="product-name" title="${escapeHtml(p.product_name)}">${escapeHtml(p.product_name)}</div>
          <div class="product-meta">
            <span style="color:${statusColor}">● ${escapeHtml(p.status)}</span>
            <span>${date}</span>
          </div>
          <details>
            <summary style="cursor:pointer;color:var(--text-muted);font-size:.75rem">Ver mensagem</summary>
            <pre style="background:rgba(0,0,0,.3);padding:.5rem;border-radius:.3rem;font-size:.7rem;white-space:pre-wrap;margin-top:.3rem;max-height:140px;overflow:auto">${escapeHtml(p.message)}</pre>
          </details>
        </div>
      `;
    }
    return '';
  }

  // ─── Fila WhatsApp ─────────────────────────────────────────────────────────
  async function loadWhatsAppQueue() {
    try {
      const data = await jget(`${API_URL}/whatsapp-queue`);
      document.getElementById('statQueue').textContent = data.length;
      const totalEl = document.getElementById('queueTotalPending');
      if (totalEl) totalEl.textContent = data.length;

      const grid = document.getElementById('whatsappQueueGrid');
      grid.innerHTML = '';

      if (data.length === 0) {
        grid.innerHTML = '<p style="color: var(--text-muted); grid-column: 1/-1; text-align: center; padding: 2rem;">Nenhuma mensagem pendente na fila.</p>';
      } else {
        data.forEach(item => {
          const div = document.createElement('div');
          div.className = 'card glass message-card';
          div.innerHTML = `
            <span class="niche-tag">${escapeHtml(item.niche)}</span>
            <div class="message-content" id="msg-${item.id}">${escapeHtml(item.message)}</div>
            <div class="message-actions">
              <button class="btn-copy" onclick="window.copyMessage(${item.id})">Copiar Texto</button>
              <button class="btn-success" onclick="window.markAsSent(${item.id})">Marcar Enviado</button>
            </div>
          `;
          grid.appendChild(div);
        });
      }

      const chips = document.getElementById('queueByNicheChips');
      if (chips) {
        try {
          const stats = await jget(`${API_URL}/whatsapp-queue/stats`);
          chips.innerHTML = (stats.byNiche || []).map(s =>
            `<span class="chip">${escapeHtml(s.niche)}: <strong>${s.count}</strong></span>`
          ).join('') || '<span style="color:var(--text-muted);font-size:.8rem">Sem pendências por nicho.</span>';
        } catch (e) { chips.innerHTML = ''; }
      }
    } catch (err) { console.error('Erro queue', err); }
  }

  window.copyMessage = function (id) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    navigator.clipboard.writeText(el.innerText).then(() => showToast('Mensagem copiada!'));
  };

  window.markAsSent = async function (id) {
    try {
      const res = await fetch(`${API_URL}/mark-whatsapp-sent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        showToast('Marcado como enviado!');
        loadWhatsAppQueue();
        loadDashboard();
      } else { showToast('Erro ao atualizar.', 'error'); }
    } catch (err) { showToast('Erro de conexão.', 'error'); }
  };

  // ─── Grupos ────────────────────────────────────────────────────────────────
  async function loadGroups() {
    try {
      const data = await jget(`${API_URL}/groups`);
      const tbody = document.getElementById('groupsBody');
      tbody.innerHTML = '';
      data.forEach(item => {
        const platformIcon = item.platform === 'telegram' ? '✈️' : '💬';
        tbody.insertAdjacentHTML('beforeend', `
          <tr>
            <td><strong>${escapeHtml(item.niche)}</strong></td>
            <td>${platformIcon} <span style="text-transform: capitalize;">${escapeHtml(item.platform)}</span></td>
            <td><code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: .8rem; word-break:break-all">${escapeHtml(item.target_id)}</code></td>
            <td><button class="btn-danger" onclick="window.deleteGroup(${item.id})">Remover</button></td>
          </tr>
        `);
      });
    } catch (err) { console.error('Erro grupos', err); }
  }

  window.deleteGroup = async function (id) {
    if (!confirm('Remover este mapeamento?')) return;
    try {
      const res = await fetch(`${API_URL}/groups/${id}`, { method: 'DELETE' });
      if (res.ok) { showToast('Grupo removido.'); loadGroups(); }
      else showToast('Erro ao remover.', 'error');
    } catch (err) { showToast('Erro de conexão.', 'error'); }
  };

  // ─── Forms ─────────────────────────────────────────────────────────────────
  document.getElementById('quickOfferForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btnQuickAdd');
    const originalText = btn.innerText;
    btn.innerText = 'Extraindo... ⏳';
    btn.disabled = true;
    try {
      const res = await fetch(`${API_URL}/quick-offer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link: document.getElementById('quickLink').value }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Sucesso! ${data.product.name} extraído.`);
        e.target.reset();
        refreshAll();
      } else showToast(data.error || 'Erro ao extrair oferta.', 'error');
    } catch (err) { showToast('Erro de conexão.', 'error'); }
    finally { btn.innerText = originalText; btn.disabled = false; }
  });

  document.getElementById('addOfferForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('offerName').value,
      oldPrice: parseFloat(document.getElementById('offerOldPrice').value),
      currentPrice: parseFloat(document.getElementById('offerCurrentPrice').value),
      discount: parseFloat(document.getElementById('offerDiscount').value || 0),
      category: document.getElementById('offerCategory').value || undefined,
      image: document.getElementById('offerImage').value,
      affiliateLink: document.getElementById('offerLink').value,
    };
    try {
      const res = await fetch(`${API_URL}/offers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) { showToast('Oferta adicionada!'); e.target.reset(); refreshAll(); }
      else showToast('Erro ao adicionar.', 'error');
    } catch (err) { showToast('Erro de conexão.', 'error'); }
  });

  document.getElementById('addGroupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      niche: document.getElementById('groupNiche').value,
      platform: document.getElementById('groupPlatform').value,
      target_id: document.getElementById('groupTargetId').value,
    };
    try {
      const res = await fetch(`${API_URL}/groups`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) { showToast('Mapeamento salvo!'); e.target.reset(); loadGroups(); }
      else { const err = await res.json(); showToast(err.error || 'Erro.', 'error'); }
    } catch (err) { showToast('Erro de conexão.', 'error'); }
  });

  // ─── Botões ────────────────────────────────────────────────────────────────
  document.getElementById('btnRunJobs').addEventListener('click', async () => {
    try { const res = await fetch(`${API_URL}/run-now`, { method: 'POST' }); if (res.ok) showToast('Processamento iniciado!'); }
    catch (err) { showToast('Erro.', 'error'); }
  });

  document.getElementById('btnDispatchNow').addEventListener('click', async () => {
    try {
      const res = await fetch(`${API_URL}/api/dispatch-now`, { method: 'POST' });
      if (res.ok) { showToast('Ciclo iniciado: garimpo → envio.'); setTimeout(refreshAll, 3000); }
    } catch (err) { showToast('Erro.', 'error'); }
  });

  const drainBtn = document.getElementById('btnDrainWorker');
  if (drainBtn) drainBtn.addEventListener('click', async () => {
    try {
      const res = await fetch(`${API_URL}/api/worker-now`, { method: 'POST' });
      if (res.ok) { showToast('Worker drenando fila...'); setTimeout(loadWhatsAppQueue, 4000); }
    } catch (err) { showToast('Erro.', 'error'); }
  });

  const aggregatorBtn = document.getElementById('btnAggregatorNow');
  if (aggregatorBtn) aggregatorBtn.addEventListener('click', async () => {
    try {
      const res = await fetch(`${API_URL}/api/aggregator-now`, { method: 'POST' });
      if (res.ok) { showToast('Garimpando Amazon...'); setTimeout(() => { loadQueuesStatus(); loadProductsByCategory(); }, 5000); }
    } catch (err) { showToast('Erro.', 'error'); }
  });

  const refreshGroupsBtn = document.getElementById('btnRefreshGroups');
  if (refreshGroupsBtn) refreshGroupsBtn.addEventListener('click', loadLiveGroups);

  const reloadQrBtn = document.getElementById('btnReloadQr');
  if (reloadQrBtn) reloadQrBtn.addEventListener('click', reloadQrFrame);

  const logoutWaBtn = document.getElementById('btnLogoutWA');
  if (logoutWaBtn) logoutWaBtn.addEventListener('click', async () => {
    if (!confirm('Limpar sessão atual e gerar novo QR Code?\n\nIsso só é necessário se você quiser trocar de número WhatsApp. Se for só problema de conexão, NÃO faça isso — o bot reconecta sozinho.')) return;
    try {
      const res = await fetch(`${API_URL}/api/whatsapp/logout`, { method: 'POST' });
      if (res.ok) {
        showToast('Sessão limpa! Aguarde o novo QR aparecer...');
        setTimeout(() => { reloadQrFrame(); loadSessionInfo(); }, 3000);
      } else showToast('Erro ao limpar sessão.', 'error');
    } catch (err) { showToast('Erro de conexão.', 'error'); }
  });

  const refreshProductsBtn = document.getElementById('btnRefreshProducts');
  if (refreshProductsBtn) refreshProductsBtn.addEventListener('click', loadProductsByCategory);

  // ─── Boot + polling ────────────────────────────────────────────────────────
  function refreshAll() {
    loadDashboard();
    loadQueuesStatus();
    refreshWhatsAppStatus();
  }

  refreshAll();
  loadWhatsAppQueue();
  loadGroups();

  // Status WhatsApp a cada 4s
  setInterval(refreshWhatsAppStatus, 4000);

  // Auto-reload do iframe QR + info de sessão a cada 10s (na aba de conexão)
  setInterval(() => {
    const tab = document.getElementById('whatsapp-conn');
    if (tab && tab.classList.contains('active')) {
      reloadQrFrame();
      loadSessionInfo();
    }
  }, 10000);

  // Dashboard/fila a cada 15s
  setInterval(() => {
    loadDashboard();
    loadQueuesStatus();
    loadWhatsAppQueue();
    const tab = document.getElementById('products');
    if (tab && tab.classList.contains('active')) loadProductsByCategory();
  }, 15000);
});
