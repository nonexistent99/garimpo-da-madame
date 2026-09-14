const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

let csrf = '';
let state = null;
let waPoll = null;
let realtimeSource = null;
let realtimeConnected = false;
let realtimeFailures = 0;
let fallbackTimer = null;
let refreshPromise = null;
let realtimeRefreshTimer = null;
let activeOrderFilter = 'all';
let orderSearch = '';
let orderStatus = 'all';
let settingsDirty = false;
let browserAlerts = false;

const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(cents) || 0) / 100);
const dateTime = value => (value ? new Date(value).toLocaleString('pt-BR') : 'Nao informado');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char]));
const cents = value => {
  let text = String(value).trim();
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  const number = Number(text);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
};
const debounceRefresh = () => {
  clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = setTimeout(() => refresh({ silent: true }), 700);
};

async function api(url, options = {}) {
  const headers = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {}),
  };
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erro ${response.status}`);
  return data;
}

async function boot() {
  try {
    const session = await api('/api/admin/session');
    csrf = session.csrf;
    showApp();
    bindControls();
    await refresh({ forceSettings: true });
    connectRealtime();
    startFallbackPolling();
    await waStatus();
  } catch {
    $('#loginView').hidden = false;
  }
}

function bindControls() {
  $('#logout')?.addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST', body: '{}' });
    location.reload();
  });

  $$('nav button').forEach(button => button.addEventListener('click', () => {
    $$('nav button,.tab').forEach(element => element.classList.remove('active'));
    button.classList.add('active');
    document.getElementById(button.dataset.tab).classList.add('active');
  }));

  $('#refreshDashboard')?.addEventListener('click', () => refresh({ forceSettings: true }));
  $('#enableNotifications')?.addEventListener('click', enableBrowserAlerts);
  $('#orderSearch')?.addEventListener('input', event => {
    orderSearch = event.target.value.trim().toLowerCase();
    renderBuyers();
  });
  $('#orderStatusFilter')?.addEventListener('change', event => {
    orderStatus = event.target.value;
    renderBuyers();
  });
  $$('[data-order-filter]').forEach(button => button.addEventListener('click', () => {
    activeOrderFilter = button.dataset.orderFilter;
    $$('[data-order-filter]').forEach(item => item.classList.toggle('active', item === button));
    renderBuyers();
  }));
  $$('#settingsForm input,#settingsForm textarea,#settingsForm select').forEach(field => {
    field.addEventListener('input', () => { settingsDirty = true; });
    field.addEventListener('change', () => { settingsDirty = true; });
  });
}

function showApp() {
  $('#loginView').hidden = true;
  $('#appView').hidden = false;
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: $('#password').value }),
    });
    csrf = data.csrf;
    showApp();
    bindControls();
    await refresh({ forceSettings: true });
    connectRealtime();
    startFallbackPolling();
  } catch (error) {
    $('#loginStatus').textContent = error.message;
    $('#loginStatus').className = 'error';
  }
});

async function refresh({ forceSettings = false, silent = false } = {}) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const previousBuyers = state?.buyers || null;
      state = normalizeOverview(await api('/api/admin/overview'));
      notifyNewApprovedOrders(previousBuyers, state.buyers);
      fillSettings({ force: forceSettings });
      renderMetrics();
      renderDiagnostics();
      renderBuyers();
      renderOffers();
      renderSystems();
      await loadHistory();
      updateLastUpdated();
    } catch (error) {
      if (!silent) toast(error.message, 'error');
      throw error;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function normalizeOverview(overview) {
  return {
    ...overview,
    buyers: (overview.buyers || []).map(order => {
      const providerStatus = String(order.provider_status || '').toLowerCase();
      const historicalImport = /^confirmed_(vip|clube)$/.test(providerStatus) && !order.email_status;
      return {
        ...order,
        plan_key: order.plan_key || (providerStatus.includes('clube') ? 'clube' : 'vip'),
        has_redeem: order.has_redeem ?? Boolean(order.redeem_expires_at),
        purchase_source: order.purchase_source || (historicalImport ? 'import' : providerStatus.includes('confirmed') ? 'lastlink' : 'manual'),
      };
    }),
  };
}

function notifyNewApprovedOrders(previousBuyers, currentBuyers) {
  if (!previousBuyers) return;
  const knownIds = new Set(previousBuyers.map(order => order.id));
  const newOrders = currentBuyers.filter(order => order.status === 'approved' && !knownIds.has(order.id));
  if (!newOrders.length) return;
  toast(newOrders.length === 1 ? 'Nova compra aprovada.' : `${newOrders.length} novas compras aprovadas.`, 'success');
  if (browserAlerts && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('Garimpo da Madame', {
      body: newOrders.length === 1 ? 'Uma nova compra entrou no painel.' : `${newOrders.length} novas compras entraram no painel.`,
    });
  }
}

function updateLastUpdated() {
  const label = $('#lastUpdated');
  if (label) label.textContent = `Atualizado ${new Date().toLocaleTimeString('pt-BR')}`;
}

function fillSettings({ force = false } = {}) {
  if (!state?.settings) return;
  const settings = state.settings;
  if (!settingsDirty || force) {
    $('#accessName').value = settings.access_name || '';
    $('#accessDescription').value = settings.access_description || '';
    $('#price').value = settings.price_cents ? String((settings.price_cents / 100).toFixed(2)).replace('.', ',') : '';
    $('#salesStatus').value = settings.sales_status;
    $('#inviteUrl').value = settings.invite_url || '';
    $('#supportPhone').value = settings.support_phone || '';
    $('#destinationGroupId').value = settings.destination_group_id || '';
    $('#emailSubject').value = settings.email_subject || '';
    $('#emailBody').value = settings.email_body || '';
    settingsDirty = false;
  }
  $('#salesPill').textContent = settings.sales_status === 'active' ? 'VENDAS ATIVAS' : 'VENDAS PAUSADAS';
}

function clearSettingsErrors() {
  $$('#settingsForm [aria-invalid="true"]').forEach(element => {
    element.removeAttribute('aria-invalid');
    element.closest('label')?.querySelector('.field-error')?.remove();
  });
}

function showSettingsErrors(errors = {}) {
  Object.entries(errors).forEach(([id, message]) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.setAttribute('aria-invalid', 'true');
    const note = document.createElement('small');
    note.className = 'field-error';
    note.textContent = message;
    input.closest('label')?.append(note);
  });
}

$('#settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  clearSettingsErrors();
  const status = $('#settingsStatus');
  status.className = 'wide';
  status.textContent = 'Salvando...';
  try {
    const data = await api('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        accessName: $('#accessName').value,
        accessDescription: $('#accessDescription').value,
        priceCents: cents($('#price').value),
        salesStatus: $('#salesStatus').value,
        inviteUrl: $('#inviteUrl').value,
        supportPhone: $('#supportPhone').value,
        destinationGroupId: $('#destinationGroupId').value,
        emailSubject: $('#emailSubject').value,
        emailBody: $('#emailBody').value,
      }),
    });
    showSettingsErrors(data.fieldErrors);
    status.textContent = data.message;
    status.className = `wide ${data.partial ? 'warning-status' : 'success'}`;
    if (!data.partial) settingsDirty = false;
    await refresh({ forceSettings: !data.partial });
  } catch (error) {
    status.textContent = error.message;
    status.className = 'wide error';
  }
});

async function loadHistory() {
  const target = $('#inviteHistory');
  if (!target) return;
  const rows = await api('/api/admin/invite-history');
  target.innerHTML = rows.length
    ? rows.map(row => `<div><strong>${dateTime(row.changed_at)}</strong> · ${row.invite_url ? 'Convite atualizado' : 'Convite removido'}</div>`).join('')
    : '<p>Nenhuma troca registrada.</p>';
}

function getFilteredBuyers() {
  const buyers = state?.buyers || [];
  return buyers.filter(order => {
    const haystack = [order.name, order.email, order.phone, order.id, order.cpf_mask].join(' ').toLowerCase();
    const planMatches = activeOrderFilter === 'all' || order.plan_key === activeOrderFilter;
    const statusMatches = orderStatus === 'all' || order.status === orderStatus || order.email_status === orderStatus;
    const searchMatches = !orderSearch || haystack.includes(orderSearch);
    return planMatches && statusMatches && searchMatches;
  });
}

function renderMetrics() {
  const buyers = state?.buyers || [];
  const approved = buyers.filter(order => order.status === 'approved');
  const metrics = state?.metrics || {};
  const totalReceived = Number.isFinite(Number(metrics.totalReceivedCents))
    ? Number(metrics.totalReceivedCents)
    : approved.reduce((sum, order) => sum + (Number(order.amount_cents) || 0), 0);
  const approvedCount = Number.isFinite(Number(metrics.approvedCount)) ? Number(metrics.approvedCount) : approved.length;
  const vipCount = Number.isFinite(Number(metrics.vipCount)) ? Number(metrics.vipCount) : approved.filter(order => order.plan_key === 'vip').length;
  const clubeCount = Number.isFinite(Number(metrics.clubeCount)) ? Number(metrics.clubeCount) : approved.filter(order => order.plan_key === 'clube').length;
  const emailIssues = approved.filter(order => !order.email_status || order.email_status === 'failed');
  $('#ordersRevenue').textContent = money(totalReceived);
  $('#ordersApproved').textContent = `${approvedCount} compras aprovadas`;
  $('#ordersVip').textContent = String(vipCount);
  $('#ordersClub').textContent = String(clubeCount);
  $('#ordersEmailIssues').textContent = String(emailIssues.length);
  $('#ordersEmailIssues').nextElementSibling.textContent = emailIssues.length ? 'Exigem atencao' : 'Fila saudavel';
}

function renderDiagnostics() {
  const diagnostics = state?.diagnostics || {};
  if (!state?.diagnostics) {
    setDiagnosticText('emailDiagnostic', 'emailDetail', state?.integrations?.smtp ? 'SMTP configurado' : 'SMTP pendente', 'Backend atual sem telemetria detalhada do worker.');
    setDiagnosticText('webhookDiagnostic', 'webhookDetail', state?.integrations?.lastlinkWebhook ? 'Webhook configurado' : 'Webhook pendente', 'Painel em modo compativel com atualizacao a cada 10 segundos.');
    return;
  }
  const worker = diagnostics.emailWorker || {};
  const webhook = diagnostics.latestWebhook;
  const imported = diagnostics.latestImport;
  setDiagnosticText('emailDiagnostic', 'emailDetail', worker.configured ? worker.lastOutcome || 'Configurado' : 'SMTP pendente', worker.lastError || `Ultima execucao: ${dateTime(worker.lastRunAt)}`);
  setDiagnosticText('webhookDiagnostic', 'webhookDetail', webhook ? webhook.status : 'Sem evento recente', webhook ? `${webhook.reason || 'Recebido'} em ${dateTime(webhook.receivedAt)}` : 'Nenhum webhook Lastlink recente');
  if (imported && !webhook) {
    setDiagnosticText('webhookDiagnostic', 'webhookDetail', 'Ultima entrada foi importacao', `${imported.reason || 'Processada'} em ${dateTime(imported.receivedAt)}`);
  }
}

function setDiagnosticText(titleId, detailId, title, detail) {
  const titleElement = document.getElementById(titleId);
  const detailElement = document.getElementById(detailId);
  if (titleElement) titleElement.textContent = title;
  if (detailElement) detailElement.textContent = detail;
}

function renderBuyers() {
  const target = $('#buyersGroups');
  const tableFallback = $('#buyers');
  if (!target && !tableFallback) return;
  const rows = getFilteredBuyers();
  const groups = [
    { key: 'vip', title: 'VIP Garimpo', subtitle: 'Acesso individual e compra direta' },
    { key: 'clube', title: 'Clube Socio', subtitle: 'Lotes, revenda e comunidade' },
  ];

  if (tableFallback) {
    tableFallback.innerHTML = rows.length ? rows.map(order => buyerTableRow(order)).join('') : '<tr><td colspan="6">Nenhum pedido encontrado.</td></tr>';
  }

  if (!target) return;
  target.innerHTML = rows.length ? groups.map(group => {
    const orders = rows.filter(order => (order.plan_key || 'vip') === group.key);
    if (!orders.length) return '';
    return `
      <section class="order-group">
        <header>
          <div>
            <strong>${group.title}</strong>
            <span>${group.subtitle}</span>
          </div>
          <b>${orders.length}</b>
        </header>
        <div class="order-cards">
          ${orders.map((order, index) => buyerCard(order, index)).join('')}
        </div>
      </section>`;
  }).join('') : '<div class="empty-state">Nenhum pedido combina com os filtros atuais.</div>';

  $$('[data-email-order]').forEach(button => button.addEventListener('click', () => queueEmail(button.dataset.emailOrder)));
}

function buyerTableRow(order) {
  const email = emailState(order);
  return `<tr>
    <td><strong>${esc(order.name)}</strong><br>${esc(order.email)}<br>${esc(order.cpf_mask)} · ${esc(order.phone)}</td>
    <td>${esc(order.id)}<br><small>${dateTime(order.created_at)}</small></td>
    <td class="status">${esc(statusLabel(order.status))}</td>
    <td>${money(order.amount_cents)}</td>
    <td>${order.has_redeem ? dateTime(order.redeem_expires_at) : 'Pagina nao gerada'}</td>
    <td>${email.label}${order.email_attempts ? ` · ${order.email_attempts} tentativa(s)` : ''}</td>
  </tr>`;
}

function buyerCard(order, index) {
  const email = emailState(order);
  const canQueue = order.status === 'approved' && Boolean(state?.capabilities?.orderEmailRecovery);
  return `
    <article class="order-card" style="--index:${Number(index) || 0}">
      <div class="order-customer">
        <span class="order-label">Comprador</span>
        <strong>${esc(order.name || 'Sem nome')}</strong>
        <small>${esc(order.email || 'sem email')}</small>
        <small>${esc(order.cpf_mask || 'CPF nao informado')} · ${esc(order.phone || 'telefone nao informado')}</small>
      </div>
      <div class="order-reference">
        <span class="order-label">Pedido</span>
        <code>${esc(order.id)}</code>
        <small>${dateTime(order.created_at)}</small>
        <span class="source-badge">${sourceLabel(order.purchase_source)}</span>
      </div>
      <div class="order-money">
        <span class="order-label">Status</span>
        <span class="status-badge ${esc(order.status)}">${esc(statusLabel(order.status))}</span>
        <strong>${money(order.amount_cents)}</strong>
      </div>
      <div class="order-access">
        <span class="order-label">Resgate</span>
        <strong>${order.has_redeem ? dateTime(order.redeem_expires_at) : 'Pagina nao gerada'}</strong>
        <small>${order.has_redeem ? 'Link temporario criado' : 'Sem token de acesso salvo'}</small>
      </div>
      <div class="order-email">
        <span class="order-label">Email</span>
        <span class="email-badge ${email.className}">${email.label}</span>
        <small>${esc(email.detail)}</small>
        ${canQueue ? `<button type="button" data-email-order="${esc(order.id)}">${email.action}</button>` : ''}
      </div>
    </article>`;
}

function statusLabel(status) {
  return {
    approved: 'Aprovado',
    pending: 'Pendente',
    revoked: 'Revogado',
    failed: 'Falhou',
  }[status] || status || 'Desconhecido';
}

function sourceLabel(source) {
  return {
    import: 'Importacao',
    lastlink: 'Lastlink',
    manual: 'Manual',
  }[source] || 'Origem';
}

function emailState(order) {
  if (!order.email_status && order.purchase_source === 'import') {
    return {
      label: 'Importacao historica',
      detail: 'Nao disparou email automaticamente; gere manual se precisar.',
      className: 'neutral',
      action: 'Gerar acesso',
    };
  }
  if (!order.email_status) {
    return {
      label: 'Nao criado',
      detail: 'Compra aprovada sem job de email. Verifique SMTP e convite.',
      className: 'warning',
      action: 'Criar email',
    };
  }
  if (order.email_status === 'sent') {
    return {
      label: 'Enviado',
      detail: order.email_sent_at ? `Enviado em ${dateTime(order.email_sent_at)}` : 'Entrega processada.',
      className: 'ok',
      action: 'Reenviar',
    };
  }
  if (order.email_status === 'failed') {
    return {
      label: 'Falhou',
      detail: order.email_error || 'Worker nao conseguiu enviar.',
      className: 'danger',
      action: 'Reprocessar',
    };
  }
  if (order.email_status === 'retry') {
    return {
      label: 'Nova tentativa',
      detail: order.email_next_attempt_at ? `Proxima: ${dateTime(order.email_next_attempt_at)}` : 'Aguardando fila.',
      className: 'warning',
      action: 'Forcar envio',
    };
  }
  return {
    label: order.email_status,
    detail: order.email_attempts ? `${order.email_attempts} tentativa(s)` : 'Na fila de envio.',
    className: 'pending',
    action: 'Recriar acesso',
  };
}

async function queueEmail(orderId) {
  if (!confirm('Gerar um novo link de acesso e colocar o email na fila?')) return;
  try {
    await api(`/api/admin/orders/${encodeURIComponent(orderId)}/email`, { method: 'POST', body: '{}' });
    toast('Email de acesso colocado na fila.', 'success');
    await refresh({ silent: true });
  } catch (error) {
    toast(error.message, 'error');
  }
}

$('#offerForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const data = await api('/api/admin/offers', {
      method: 'POST',
      body: JSON.stringify({ exactName: $('#exactName').value, priceCents: cents($('#offerPrice').value) }),
    });
    $('#offerStatus').textContent = `Oferta ${data.id} em pesquisa.`;
    event.target.reset();
    setTimeout(() => refresh({ silent: true }), 1800);
  } catch (error) {
    $('#offerStatus').textContent = error.message;
    $('#offerStatus').className = 'error';
  }
});

function renderOffers() {
  $('#offersList').innerHTML = state.offers.length ? state.offers.map(offer => `
    <article class="card">
      <div>
        <strong>${esc(offer.exact_name)}</strong>
        <p>${money(offer.price_cents)} · status: <b>${esc(offer.status)}</b></p>
        <p>${esc(offer.failure_reason || offer.model_identified || 'Processando...')}</p>
      </div>
      ${offer.status === 'ready' ? `<button data-publish="${esc(offer.id)}">Publicar</button>` : ''}
      ${offer.status === 'needs_real_photo' ? `<form data-photo="${esc(offer.id)}"><label>Foto real para liberar<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required></label><button class="primary">Enviar foto e publicar</button></form>` : ''}
    </article>`).join('') : '<p>Nenhuma oferta criada.</p>';

  $$('[data-publish]').forEach(button => button.addEventListener('click', async () => {
    await api(`/api/admin/offers/${encodeURIComponent(button.dataset.publish)}/publish`, { method: 'POST', body: '{}' });
    refresh({ silent: true });
  }));

  $$('[data-photo]').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    await api(`/api/admin/offers/${encodeURIComponent(form.dataset.photo)}/photo`, { method: 'POST', body: data });
    setTimeout(() => refresh({ silent: true }), 1200);
  }));
}

function renderSystems() {
  const labels = {
    lastlinkCheckout: 'Checkouts VIP e Clube',
    lastlinkWebhook: 'Webhooks VIP e Clube',
    lastlinkProduct: 'Produtos Lastlink',
    smtp: 'Email transacional',
    aiResearch: 'Pesquisa com IA',
  };
  $('#integrations').innerHTML = Object.entries(state.integrations).map(([key, configured]) => `
    <div class="system">
      <strong>${labels[key] || key}</strong>
      <span class="${configured ? 'ok' : 'missing'}">${configured ? 'Configurado' : 'Pendente'}</span>
    </div>`).join('');
}

function setRealtimeStatus(status, detail) {
  const element = $('#realtimeStatus');
  if (!element) return;
  element.className = `live-status ${status}`;
  $('#realtimeLabel').textContent = `${status === 'live' ? 'Ao vivo' : status === 'warn' ? 'Reconectando' : 'Offline'} · ${detail}`;
}

function connectRealtime() {
  if (!window.EventSource) {
    setRealtimeStatus('warn', 'Navegador sem SSE; usando atualizacao periodica');
    return;
  }
  realtimeSource?.close();
  realtimeSource = new EventSource('/api/admin/events');
  realtimeSource.onopen = () => {
    realtimeConnected = true;
    realtimeFailures = 0;
    setRealtimeStatus('live', 'Compras e emails chegam em tempo real');
  };
  realtimeSource.onerror = () => {
    realtimeConnected = false;
    realtimeFailures += 1;
    if (realtimeFailures >= 2) {
      realtimeSource?.close();
      realtimeSource = null;
      setRealtimeStatus('warn', 'Atualizacao automatica a cada 10 segundos');
      return;
    }
    setRealtimeStatus('warn', 'Tentando conectar; polling continua ativo');
  };
  realtimeSource.onmessage = event => {
    const payload = JSON.parse(event.data || '{}');
    if (payload.type === 'connected') return;
    handleRealtimeEvent(payload);
  };
}

function startFallbackPolling() {
  clearInterval(fallbackTimer);
  fallbackTimer = setInterval(() => refresh({ silent: true }), 10000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh({ silent: true });
  });
}

function handleRealtimeEvent(event) {
  const labels = {
    'purchase.approved': 'Compra aprovada',
    'purchase.updated': 'Pedido atualizado',
    'purchase.revoked': 'Acesso revogado',
    'purchases.imported': 'Importacao concluida',
    'email.queued': 'Email na fila',
    'email.sent': 'Email enviado',
    'email.retry': 'Email em nova tentativa',
    'email.failed': 'Email falhou',
    'webhook.rejected': 'Webhook rejeitado',
    'webhook.failed': 'Webhook falhou',
  };
  const title = labels[event.type] || 'Atualizacao recebida';
  toast(title, event.type?.includes('failed') || event.type?.includes('rejected') ? 'error' : 'success');
  if (browserAlerts && event.type === 'purchase.approved' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('Garimpo da Madame', { body: 'Nova compra aprovada no painel.' });
  }
  debounceRefresh();
}

async function enableBrowserAlerts() {
  if (!('Notification' in window)) {
    toast('Este navegador nao suporta notificacoes.', 'error');
    return;
  }
  const permission = await Notification.requestPermission();
  browserAlerts = permission === 'granted';
  toast(browserAlerts ? 'Alertas do navegador ativados.' : 'Alertas nao foram autorizados.', browserAlerts ? 'success' : 'error');
}

function toast(message, type = 'info') {
  let region = $('#toastRegion');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toastRegion';
    region.className = 'toast-region';
    document.body.append(region);
  }
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  region.append(item);
  setTimeout(() => item.remove(), 5200);
}

function setWaVisual(data) {
  const status = data.status || 'disconnected';
  const pill = $('#waPill');
  const image = $('#waQrImage');
  const placeholder = $('#waQrPlaceholder');
  const labels = { connected: 'Conectado', qr_ready: 'QR pronto', starting: 'Iniciando', disconnected: 'Desconectado' };
  pill.textContent = labels[status] || status;
  pill.className = `wa-pill ${status}`;
  $('#waStatus').textContent = JSON.stringify({ ...data, qr: data.qr ? '[QR Code disponivel]' : undefined, raw: undefined }, null, 2);
  if (data.qr) {
    image.src = data.qr;
    image.hidden = false;
    placeholder.hidden = true;
    $('#waMessage').textContent = 'QR Code pronto. Escaneie agora com o celular.';
    return;
  }
  image.hidden = true;
  image.removeAttribute('src');
  placeholder.hidden = false;
  if (status === 'connected') {
    $('#waMessage').textContent = data.connectedAt ? `WhatsApp conectado desde ${dateTime(data.connectedAt)}.` : 'WhatsApp conectado com sucesso.';
    placeholder.innerHTML = '<span class="wa-check">✓</span><p>WhatsApp conectado</p>';
  } else {
    $('#waMessage').textContent = status === 'starting' ? 'Gerando o QR Code...' : 'WhatsApp desconectado. Gere um novo QR Code.';
    placeholder.innerHTML = '<span>QR</span><p>O codigo aparecera aqui</p>';
  }
  if (status === 'connected' && waPoll) {
    clearInterval(waPoll);
    waPoll = null;
  }
}

async function waStatus() {
  try {
    const [status, qr] = await Promise.all([api('/api/whatsapp/status'), api('/api/whatsapp/qr.json')]);
    setWaVisual({ ...status, ...qr });
  } catch (error) {
    $('#waMessage').textContent = error.message;
    $('#waStatus').textContent = error.message;
  }
}

function startWaPolling() {
  if (waPoll) clearInterval(waPoll);
  waPoll = setInterval(waStatus, 3000);
  setTimeout(() => {
    if (waPoll) {
      clearInterval(waPoll);
      waPoll = null;
    }
  }, 120000);
}

$('#waStatusBtn').addEventListener('click', waStatus);
$('#startWa').addEventListener('click', async () => {
  const button = $('#startWa');
  button.disabled = true;
  $('#waMessage').textContent = 'Solicitando conexao...';
  try {
    const result = await api('/api/whatsapp/start', { method: 'POST', body: '{}' });
    setWaVisual(result);
    await waStatus();
    startWaPolling();
  } catch (error) {
    $('#waMessage').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

boot();
