const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let offer;
let selectedPlan = null;
const track = (name, parameters = {}) => window.trackLandingEvent?.(name, parameters);
const plans = {
  vip: { label: 'VIP GARIMPO', name: 'VIP Garimpo', description: 'Um ano inteiro para chegar antes, ativar benefícios pelo CPF e pagar menos em produtos selecionados.' },
  clube: { label: 'CLUBE SÓCIO', name: 'Clube Sócio', description: 'Para CNPJ, lojistas e revendedores que buscam lotes e condições de compra em quantidade.' },
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

function formatPhone(value) {
  const digits = String(value || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
  if (!digits) return '';
  if (digits.length < 3) return `(${digits}`;
  const area = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (rest.length <= 4) return `(${area}) ${rest}`;
  const split = rest.length > 8 ? 5 : 4;
  return `(${area}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

['buyerPhone', 'rewardPhone'].forEach(id => {
  const input = document.getElementById(id);
  input?.addEventListener('input', () => { input.value = formatPhone(input.value); });
});

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

const storeVideos = $$('.store-video');
let activeStoreVideo = null;
function playOnly(video, fromScroll = false) {
  storeVideos.forEach(other => { if (other !== video) other.pause(); });
  if (fromScroll && activeStoreVideo !== video) video.muted = true;
  activeStoreVideo = video;
  video.play().catch(() => {});
}
storeVideos.forEach(video => video.addEventListener('play', () => playOnly(video)));
if ('IntersectionObserver' in window && storeVideos.length) {
  const ratios = new Map();
  const videoObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => ratios.set(entry.target, entry.intersectionRatio));
    const visible = [...ratios.entries()].filter(([, ratio]) => ratio >= .55).sort((a, b) => b[1] - a[1])[0];
    if (visible) playOnly(visible[0], true);
    else if (activeStoreVideo) activeStoreVideo.pause();
  }, { threshold: [0, .25, .55, .75, 1] });
  storeVideos.forEach(video => videoObserver.observe(video));
}
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
const slideClaim = $('#slideClaim');
let rewardUnlocking = false;

function showRewardUnlocked(phone) {
  if (phone) $('#buyerPhone').value = phone;
  rewardClaim.hidden = true;
  rewardUnlocked.hidden = false;
  track('reward_claimed', { reward: '75_percent_discount' });
}

function setRewardProgress(value) {
  const progress = Math.max(0, Math.min(100, Number(value) || 0));
  slideClaim?.style.setProperty('--progress', `${progress}%`);
  const thumb = slideClaim?.querySelector('span');
  if (thumb && slideClaim) {
    const maxTravel = Math.max(0, slideClaim.clientWidth - thumb.offsetWidth - 10);
    thumb.style.transform = `translateX(${Math.round(maxTravel * progress / 100)}px)`;
  }
  return progress;
}

function openReward() {
  if (sessionStorage.getItem('garimpo_reward_seen') || !rewardDialog) return;
  sessionStorage.setItem('garimpo_reward_seen', '1');
  rewardDialog.showModal();
  track('reward_popup_open', { placement: 'after_real_store' });
}

if (rewardDialog && 'IntersectionObserver' in window) {
  new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) openReward();
  }, { threshold: .35 }).observe($('#rewardTrigger'));
}

rewardSlider?.addEventListener('input', () => {
  if (rewardUnlocking) return;
  const progress = setRewardProgress(rewardSlider.value);
  slideClaim.classList.add('is-dragging');
  rewardSlider.setAttribute('aria-valuetext', `${progress}% resgatado`);
  if (progress < 25) $('#rewardStatus').textContent = 'Arraste a seta até o fim para resgatar.';
  else if (progress < 75) $('#rewardStatus').textContent = 'Boa! Continue deslizando.';
  else if (progress < 94) $('#rewardStatus').textContent = 'Quase lá. Solte só no final.';
  if (progress < 94) return;
  const phone = normalizePhone(rewardPhone.value);
  if (!phone) {
    rewardSlider.value = 0;
    setRewardProgress(0);
    slideClaim.classList.remove('is-dragging');
    $('#rewardStatus').textContent = 'Informe um WhatsApp válido com DDD antes de resgatar.';
    rewardPhone.focus();
    return;
  }
  rewardUnlocking = true;
  setRewardProgress(100);
  slideClaim.classList.remove('is-dragging');
  slideClaim.classList.add('ready');
  $('#rewardStatus').textContent = 'Resgate confirmado!';
  setTimeout(() => showRewardUnlocked(phone), 520);
});

rewardSlider?.addEventListener('pointerdown', () => slideClaim?.classList.add('is-dragging'));
rewardSlider?.addEventListener('pointerup', () => {
  if (!rewardUnlocking) slideClaim?.classList.remove('is-dragging');
});

rewardPhone?.addEventListener('input', () => {
  const valid = Boolean(normalizePhone(rewardPhone.value));
  $('#rewardStatus').textContent = valid ? 'Número pronto. Agora arraste a seta.' : '';
  rewardPhone.setAttribute('aria-invalid', valid ? 'false' : 'true');
});

$('#rewardCheckout')?.addEventListener('click', () => {
  rewardDialog.close();
  document.querySelector('.js-plan[data-plan="vip"]')?.click();
  setTimeout(() => $('#buyerName').focus(), 550);
});

loadOffer();
