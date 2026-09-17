const $ = selector => document.querySelector(selector);
let csrf = '';
let documentType = 'cpf';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
}

function showApp() {
  $('#loginView').hidden = true;
  $('#appView').hidden = false;
  $('#document').focus();
}

function formatDocument(value) {
  const maxDigits = documentType === 'cnpj' ? 14 : 11;
  const digits = String(value || '').replace(/\D/g, '').slice(0, maxDigits);
  if (documentType === 'cnpj') {
    return digits
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }
  return digits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/(\d{3})(\d)/, '$1-$2');
}

function selectDocumentType(type) {
  documentType = type;
  document.querySelectorAll('.document-type').forEach(button => {
    const active = button.dataset.documentType === type;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const cnpj = type === 'cnpj';
  $('#documentLabel span').textContent = `${cnpj ? 'CNPJ' : 'CPF'} do cliente`;
  $('#document').value = '';
  $('#document').maxLength = cnpj ? 18 : 14;
  $('#document').placeholder = cnpj ? '00.000.000/0000-00' : '000.000.000-00';
  $('#result').hidden = true;
  $('#document').focus();
}

async function boot() {
  try {
    const session = await api('/api/staff/session');
    csrf = session.csrf;
    showApp();
  } catch {
    $('#loginView').hidden = false;
  }
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const session = await api('/api/staff/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('#username').value.trim(), password: $('#password').value }),
    });
    csrf = session.csrf;
    showApp();
  } catch (error) {
    $('#loginStatus').textContent = error.message;
  }
});

document.querySelectorAll('.document-type').forEach(button => {
  button.addEventListener('click', () => selectDocumentType(button.dataset.documentType));
});

$('#document').addEventListener('input', event => {
  event.target.value = formatDocument(event.target.value);
});

$('#lookupForm').addEventListener('submit', async event => {
  event.preventDefault();
  const result = $('#result');
  result.hidden = false;
  result.className = 'result';
  result.textContent = 'Consultando cadastro…';
  try {
    const data = await api('/api/staff/cpf-lookup', {
      method: 'POST',
      body: JSON.stringify({ document: $('#document').value }),
    });
    if (!data.found) {
      const label = documentType === 'cnpj' ? 'CNPJ' : 'CPF';
      result.className = 'result not-found';
      result.innerHTML = `<p class="kicker">NENHUM CADASTRO ATIVO</p><h2>Cliente não encontrado</h2><p>Não há uma compra registrada para este ${label}.</p>`;
      return;
    }
    const formatDate = value => new Date(value).toLocaleDateString('pt-BR');
    const type = data.documentType || (documentType === 'cnpj' ? 'CNPJ' : 'CPF');
    const lastFive = data.documentLastFive || data.cpfLastFive;
    result.innerHTML = `<p class="kicker">CLIENTE LOCALIZADO</p><h2>${escapeHtml(data.customer)}</h2><span class="pill">BENEFÍCIO ${escapeHtml(data.status).toUpperCase()}</span><div class="result-grid"><div class="data"><small>${escapeHtml(type)} CONFERIDO</small><strong>Final ${escapeHtml(lastFive)}</strong></div><div class="data"><small>PLANO</small><strong>${escapeHtml(data.plan)}</strong></div><div class="data"><small>VÁLIDO ATÉ</small><strong>${formatDate(data.validUntil)}</strong></div></div>`;
  } catch (error) {
    result.className = 'result not-found';
    result.textContent = error.message;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/api/staff/logout', { method: 'POST' }).catch(() => {});
  csrf = '';
  $('#appView').hidden = true;
  $('#loginView').hidden = false;
  $('#password').value = '';
});

boot();
