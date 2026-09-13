const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let offer;
let selectedPlan = null;
const track = (name, parameters = {}) => window.trackLandingEvent?.(name, parameters);
const plans = {
  vip: { label: 'VIP GARIMPO', name: 'VIP Garimpo', description: 'Descontos em produtos participantes, grupo privado, pedidos pelo WhatsApp e novidades antecipadas.' },
  clube: { label: 'CLUBE SÓCIO', name: 'Clube Sócio', description: 'Para CNPJ e compras em lote, com atendimento comercial e acesso antecipado às novidades.' },
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
}

function setCtasEnabled(enabled) {
  $$('.js-access-cta').forEach(cta => {
    cta.dataset.sales = enabled ? 'open' : 'pending';
  });
}

async function loadOffer() {
  try {
    offer = await api('/api/public/offer');
    setCtasEnabled(Boolean(offer.checkoutUrls?.vip || offer.checkoutUrls?.clube));
    if (offer.checkoutUrls?.vip || offer.checkoutUrls?.clube) track('view_item', { items: [{ item_id: 'planos_garimpo', item_name: 'Planos Garimpo da Madame' }] });
  } catch (error) {
    setCtasEnabled(false);
    $('#formStatus').className = 'form-status';
    $('#formStatus').textContent = 'O pagamento online será liberado em breve. Nenhuma cobrança será iniciada.';
  }
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return '';
  return digits.startsWith('55') ? `+${digits}` : `+55${digits}`;
}

function checkoutUrlFor(name, phone) {
  const checkout = new URL(offer.checkoutUrls[selectedPlan]);
  const current = new URLSearchParams(location.search);
  for (const [key, value] of current) if (/^(utm_|src$|sck$|vtid$)/i.test(key)) checkout.searchParams.set(key, value);
  checkout.searchParams.set('name', name.trim());
  checkout.searchParams.set('phone', phone);
  return checkout.toString();
}

$('#checkoutForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!selectedPlan) {
    $('#formStatus').className = 'form-status error';
    $('#formStatus').textContent = 'Escolha um plano antes de continuar.';
    document.querySelector('.plans-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (!offer?.checkoutUrls?.[selectedPlan]) {
    $('#formStatus').className = 'form-status error';
    $('#formStatus').textContent = 'O checkout deste plano ainda está sendo configurado.';
    return;
  }

  const name = $('#buyerName').value.trim();
  const phone = normalizePhone($('#buyerPhone').value);
  if (name.length < 3) {
    $('#formStatus').className = 'form-status error';
    $('#formStatus').textContent = 'Informe seu nome completo para continuar.';
    $('#buyerName').focus();
    return;
  }
  if (!phone) {
    $('#formStatus').className = 'form-status error';
    $('#formStatus').textContent = 'Informe um WhatsApp válido com DDD.';
    $('#buyerPhone').focus();
    return;
  }
  if (!$('#termsAccepted').checked) {
    $('#formStatus').className = 'form-status error';
    $('#formStatus').textContent = 'Aceite os termos e o aviso de privacidade para continuar.';
    $('#termsAccepted').focus();
    return;
  }
  try {
    const checkoutUrl = checkoutUrlFor(name, phone);
    track('begin_checkout', {
      items: [{ item_id: selectedPlan, item_name: plans[selectedPlan].name }]
    });
    window.location.assign(checkoutUrl);
  } catch {
    $('#formStatus').className = 'form-status error';
    $('#formStatus').textContent = 'Não foi possível abrir o checkout. Tente novamente.';
  }
});

$$('.js-plan').forEach(button => button.addEventListener('click', () => {
  selectedPlan = button.dataset.plan;
  const plan = plans[selectedPlan];
  $$('.plan-card').forEach(card => card.classList.toggle('selected', card.dataset.plan === selectedPlan));
  $('#selectedPlanLabel').textContent = plan.label;
  $('#selectedPlanName').textContent = plan.name;
  $('#selectedPlanDescription').textContent = plan.description;
  $('#payButton').querySelector('span').textContent = offer?.checkoutUrls?.[selectedPlan] ? `IR PARA O CHECKOUT ${plan.label}` : 'CHECKOUT EM CONFIGURAÇÃO';
  $('#payButton').toggleAttribute('aria-disabled', !offer?.checkoutUrls?.[selectedPlan]);
  $('#formStatus').textContent = offer?.checkoutUrls?.[selectedPlan] ? '' : 'O checkout deste plano será liberado em breve.';
  $('#checkoutForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  track('plan_selected', { plan: selectedPlan });
}));

$$('.js-access-cta').forEach((cta, index) => {
  cta.addEventListener('click', () => track('access_cta_click', {
    cta_position: cta.id === 'mainCta' ? 'hero' : cta.classList.contains('mobile-cta') ? 'mobile_fixed' : `section_${index + 1}`
  }));
});

$$('[data-dialog]').forEach(button => {
  button.addEventListener('click', () => document.getElementById(button.dataset.dialog).showModal());
});

$$('dialog .close').forEach(button => {
  button.addEventListener('click', () => button.closest('dialog').close());
});

const rewardDialog = $('#rewardDialog');
const rewardClaim = $('#rewardClaim');
const rewardUnlocked = $('#rewardUnlocked');
const rewardPhone = $('#rewardPhone');
const rewardSlider = $('#rewardSlider');
const rewardExpiryKey = 'garimpo_reward_75_expiry';
let rewardExpiry;

function updateRewardCountdown() {
  const seconds = Math.max(0, Math.ceil((rewardExpiry - Date.now()) / 1000));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const secs = String(seconds % 60).padStart(2, '0');
  $('#rewardCountdown').textContent = `${hours}:${minutes}:${secs}`;
  if (!seconds) localStorage.removeItem(rewardExpiryKey);
}

function showRewardUnlocked(phone) {
  rewardExpiry = Number(localStorage.getItem(rewardExpiryKey)) || (Date.now() + 24 * 60 * 60 * 1000);
  localStorage.setItem(rewardExpiryKey, String(rewardExpiry));
  if (phone) $('#buyerPhone').value = phone;
  rewardClaim.hidden = true;
  rewardUnlocked.hidden = false;
  updateRewardCountdown();
  track('reward_claimed', { reward: '75_percent_discount' });
}

function openReward() {
  if (sessionStorage.getItem('garimpo_reward_seen') || !rewardDialog) return;
  sessionStorage.setItem('garimpo_reward_seen', '1');
  const expiresAt = Number(localStorage.getItem(rewardExpiryKey));
  if (expiresAt > Date.now()) showRewardUnlocked();
  rewardDialog.showModal();
  track('reward_popup_open', { placement: 'after_real_store' });
}

if (rewardDialog && 'IntersectionObserver' in window) {
  new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) openReward();
  }, { threshold: .35 }).observe($('#rewardTrigger'));
}

rewardSlider?.addEventListener('input', () => {
  if (Number(rewardSlider.value) < 94) return;
  const phone = normalizePhone(rewardPhone.value);
  if (!phone) {
    rewardSlider.value = 0;
    $('#rewardStatus').textContent = 'Informe um WhatsApp válido com DDD antes de resgatar.';
    rewardPhone.focus();
    return;
  }
  showRewardUnlocked(phone);
});

$('#rewardCheckout')?.addEventListener('click', () => {
  rewardDialog.close();
  document.querySelector('.js-plan[data-plan="vip"]')?.click();
  $('#acesso').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => $('#buyerName').focus(), 550);
});

loadOffer();
