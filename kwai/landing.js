const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let offer;
let selectedPlan = null;
const track = (name, parameters = {}) => window.trackLandingEvent?.(name, { traffic_source: 'kwai', ...parameters });
let paymentPoll;
const trackedOnce = new Set();
const trackOnce = (key, name, parameters = {}) => {
  if (trackedOnce.has(key)) return;
  trackedOnce.add(key);
  track(name, parameters);
};
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
    offer = await api('/api/public/kwai-offer');
    setCtasEnabled(Boolean(offer.configured));
    if (offer.configured) track('view_item', { items: [{ item_id: 'planos_garimpo', item_name: 'Planos Garimpo da Madame' }] });
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

function formatDocument(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 11) return digits.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return digits.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}
$('#buyerDocument')?.addEventListener('input', event => { event.target.value = formatDocument(event.target.value); });

function checkoutTracking() {
  const params = new URLSearchParams(location.search);
  const data = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    if (params.get(key)) data[key] = params.get(key);
  }
  data.utm_source ||= 'kwai';
  return data;
}

function showPix(result) {
  clearInterval(paymentPoll);
  $('#checkoutForm').classList.add('is-paying');
  $('#pixPanel').hidden = false;
  $('#pixQr').src = result.pixQrBase64;
  $('#pixCode').value = result.pixCode;
  $('#pixAmount').textContent = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(result.amountCents / 100);
  $('#pixStatus').className = 'pix-status';
  $('#pixStatus').textContent = 'Aguardando a confirmação do pagamento…';
  $('#pixPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  track('add_payment_info', { payment_type: 'pix', value: result.amountCents / 100, currency: 'BRL', items: [{ item_id: selectedPlan, item_name: plans[selectedPlan].name }] });
  let checks = 0;
  paymentPoll = setInterval(async () => {
    checks += 1;
    try {
      const order = await api(`/api/public/orders/${encodeURIComponent(result.orderId)}`);
      if (order.status === 'approved') {
        clearInterval(paymentPoll);
        $('#pixStatus').className = 'pix-status approved';
        $('#pixStatus').textContent = 'Pagamento confirmado! Enviamos as instruções de acesso para o seu e-mail.';
        trackOnce(`purchase_${result.orderId}`, 'purchase', { transaction_id: result.orderId, value: result.amountCents / 100, currency: 'BRL', items: [{ item_id: selectedPlan, item_name: plans[selectedPlan].name }] });
      } else if (['failed', 'refunded', 'chargeback'].includes(order.status)) {
        clearInterval(paymentPoll);
        $('#pixStatus').textContent = 'O pagamento não foi concluído. Gere um novo PIX para tentar novamente.';
      }
    } catch {}
    if (checks >= 360) clearInterval(paymentPoll);
  }, 5000);
}

$('#copyPix')?.addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#pixCode').value);
  $('#copyPix span').textContent = 'CÓDIGO COPIADO';
  track('pix_copy', { plan: selectedPlan });
  setTimeout(() => { $('#copyPix span').textContent = 'COPIAR CÓDIGO PIX'; }, 1800);
});

$('#checkoutForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!selectedPlan) {
    track('form_error', { form_name: 'access_checkout', field_name: 'plan', error_type: 'missing_plan' });
    $('#formStatus').className = 'form-status error';
    $('#formStatus').textContent = 'Escolha um plano antes de continuar.';
    document.querySelector('.plans-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (!offer?.configured) {
    track('form_error', { form_name: 'access_checkout', field_name: 'plan', error_type: 'checkout_unavailable', plan: selectedPlan });
    $('#formStatus').className = 'form-status error';
    $('#formStatus').textContent = 'O checkout deste plano ainda está sendo configurado.';
    return;
  }

  const name = $('#buyerName').value.trim();
  const email = $('#buyerEmail').value.trim().toLowerCase();
  const phone = normalizePhone($('#buyerPhone').value);
  const document = $('#buyerDocument').value.replace(/\D/g, '');
  if (name.length < 3) {
    track('form_error', { form_name: 'access_checkout', field_name: 'name', error_type: 'invalid_name', plan: selectedPlan });
    $('#formStatus').className = 'form-status error';
    $('#formStatus').textContent = 'Informe seu nome completo para continuar.';
    $('#buyerName').focus();
    return;
  }
  if (!phone) {
    track('form_error', { form_name: 'access_checkout', field_name: 'phone', error_type: 'invalid_phone', plan: selectedPlan });
    $('#formStatus').className = 'form-status error';
    $('#formStatus').textContent = 'Informe um WhatsApp válido com DDD.';
    $('#buyerPhone').focus();
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    $('#formStatus').className = 'form-status error';
    $('#formStatus').textContent = 'Informe um e-mail válido para receber o acesso.';
    $('#buyerEmail').focus();
    return;
  }
  if (![11, 14].includes(document.length)) {
    $('#formStatus').className = 'form-status error';
    $('#formStatus').textContent = 'Informe um CPF ou CNPJ válido.';
    $('#buyerDocument').focus();
    return;
  }
  if (!$('#termsAccepted').checked) {
    track('form_error', { form_name: 'access_checkout', field_name: 'terms', error_type: 'terms_not_accepted', plan: selectedPlan });
    $('#formStatus').className = 'form-status error';
    $('#formStatus').textContent = 'Aceite os termos e o aviso de privacidade para continuar.';
    $('#termsAccepted').focus();
    return;
  }
  try {
    track('begin_checkout', {
      value: (offer.plans?.[selectedPlan]?.amountCents || 0) / 100,
      currency: 'BRL',
      items: [{ item_id: selectedPlan, item_name: plans[selectedPlan].name }]
    });
    $('#payButton').disabled = true;
    $('#payButton span').textContent = 'GERANDO PIX…';
    const result = await api('/api/public/sunize/orders', {
      method: 'POST',
      body: JSON.stringify({ name, email, phone, document, plan: selectedPlan, terms: true, marketing: $('#marketingAccepted').checked, ...checkoutTracking() })
    });
    showPix(result);
  } catch (error) {
    track('form_error', { form_name: 'access_checkout', field_name: 'checkout', error_type: 'redirect_failed', plan: selectedPlan });
    $('#formStatus').className = 'form-status error';
    $('#formStatus').textContent = error.message || 'Não foi possível gerar o PIX. Tente novamente.';
    $('#payButton').disabled = false;
    $('#payButton span').textContent = `GERAR PIX ${plans[selectedPlan].label}`;
  }
});

$$('.js-plan').forEach(button => button.addEventListener('click', () => {
  selectedPlan = button.dataset.plan;
  const plan = plans[selectedPlan];
  $$('.plan-card').forEach(card => card.classList.toggle('selected', card.dataset.plan === selectedPlan));
  $('#selectedPlanLabel').textContent = plan.label;
  $('#selectedPlanName').textContent = plan.name;
  $('#selectedPlanDescription').textContent = plan.description;
  $('#payButton').querySelector('span').textContent = offer?.configured ? `GERAR PIX ${plan.label}` : 'CHECKOUT EM CONFIGURAÇÃO';
  $('#payButton').toggleAttribute('aria-disabled', !offer?.configured);
  $('#formStatus').textContent = offer?.configured ? '' : 'O checkout deste plano será liberado em breve.';
  $('#checkoutForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  track('plan_selected', { plan: selectedPlan });
  track('select_item', {
    item_list_id: 'access_plans',
    item_list_name: 'Acessos Garimpo da Madame',
    items: [{ item_id: selectedPlan, item_name: plan.name }]
  });
}));

$('#checkoutForm').addEventListener('focusin', () => {
  trackOnce('access_checkout_started', 'access_form_start', {
    form_name: 'access_checkout',
    plan: selectedPlan || 'not_selected'
  });
});

$$('.js-access-cta').forEach((cta, index) => {
  cta.addEventListener('click', () => track('access_cta_click', {
    cta_position: cta.id === 'mainCta' ? 'hero' : cta.classList.contains('mobile-cta') ? 'mobile_fixed' : `section_${index + 1}`
  }));
});

const sectionTargets = [
  ['planos', $('#planos')],
  ['beneficios', $('#por-dentro')],
  ['prova_real', $('.real-store')],
  ['como_funciona', $('#como-funciona')],
  ['reforco_cta', $('#acesso')],
  ['formulario', $('.checkout-wrap')]
].filter(([, element]) => element);

if ('IntersectionObserver' in window) {
  const sectionObserver = new IntersectionObserver(entries => {
    entries.filter(entry => entry.isIntersecting).forEach(entry => {
      const section = sectionTargets.find(([, element]) => element === entry.target);
      if (!section) return;
      trackOnce(`section_${section[0]}`, 'section_view', {
        section_id: section[0],
        section_position: sectionTargets.indexOf(section) + 1
      });
      if (section[0] === 'planos') {
        trackOnce('plans_viewed', 'view_item_list', {
          item_list_id: 'access_plans',
          item_list_name: 'Acessos Garimpo da Madame',
          items: Object.entries(plans).map(([id, plan]) => ({ item_id: id, item_name: plan.name }))
        });
      }
      sectionObserver.unobserve(entry.target);
    });
  }, { threshold: .35 });
  sectionTargets.forEach(([, element]) => sectionObserver.observe(element));
}

const scrollMilestones = [25, 50, 75, 90];
let scrollFramePending = false;
function measureScrollDepth() {
  scrollFramePending = false;
  const available = document.documentElement.scrollHeight - window.innerHeight;
  if (available <= 0) return;
  const depth = Math.round((window.scrollY / available) * 100);
  scrollMilestones.forEach(percent => {
    if (depth >= percent) trackOnce(`scroll_${percent}`, 'scroll_depth', { percent_scrolled: percent });
  });
}
window.addEventListener('scroll', () => {
  if (scrollFramePending) return;
  scrollFramePending = true;
  requestAnimationFrame(measureScrollDepth);
}, { passive: true });
measureScrollDepth();

const storeVideos = $$('.store-video');
let activeStoreVideo = null;
function playOnly(video, fromScroll = false) {
  storeVideos.forEach(other => { if (other !== video) other.pause(); });
  if (fromScroll && activeStoreVideo !== video) video.muted = true;
  activeStoreVideo = video;
  video.play().catch(() => {});
}
storeVideos.forEach((video, index) => {
  const videoId = `store_video_${index + 1}`;
  const videoTitle = video.closest('figure')?.querySelector('figcaption strong')?.textContent?.trim() || videoId;
  const progressSeen = new Set();
  video.addEventListener('play', () => {
    playOnly(video);
    trackOnce(`${videoId}_start`, 'video_start', { video_id: videoId, video_title: videoTitle });
  });
  video.addEventListener('volumechange', () => {
    if (!video.muted && video.volume > 0) trackOnce(`${videoId}_unmute`, 'video_unmute', { video_id: videoId, video_title: videoTitle });
  });
  video.addEventListener('timeupdate', () => {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    const watched = (video.currentTime / video.duration) * 100;
    [25, 50, 75].forEach(percent => {
      if (watched < percent || progressSeen.has(percent)) return;
      progressSeen.add(percent);
      track('video_progress', { video_id: videoId, video_title: videoTitle, video_percent: percent });
    });
    if (watched >= 90) trackOnce(`${videoId}_complete`, 'video_complete', { video_id: videoId, video_title: videoTitle });
  });
});
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
let rewardSliderStarted = false;

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
  if (!rewardSliderStarted) {
    rewardSliderStarted = true;
    track('reward_slider_started', { placement: 'after_real_store' });
  }
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

rewardDialog?.addEventListener('close', () => {
  if (!rewardUnlocking && !rewardClaim.hidden) {
    trackOnce('reward_popup_dismissed', 'reward_popup_closed', {
      placement: 'after_real_store',
      slider_started: rewardSliderStarted
    });
  }
});

$('#rewardCheckout')?.addEventListener('click', () => {
  rewardDialog.close();
  document.querySelector('.js-plan[data-plan="vip"]')?.click();
  setTimeout(() => $('#buyerName').focus(), 550);
});

loadOffer();
