const axios = require('axios');
const cheerio = require('cheerio');
const { parsePrice, validatePriceData } = require('./priceValidator');
const { buildCleanAffiliateLink } = require('./linkCleaner');

const USER_AGENT = 'offers-workspace/1.0 (+manual-product-import)';

async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        timeout: 10000,
        validateStatus: status => status === 200,
      });
      return response.data;
    } catch (err) {
      const delay = 1500 * (i + 1);
      console.warn(`[Scraper Retry] Falha ao acessar ${url} (tentativa ${i + 1}/${retries}): ${err.message}`);
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw new Error('Falha de conexao ao buscar a pagina do produto.');
}

function extractFromWholeFraction(container) {
  if (!container || container.length === 0) return '';
  const whole = container.find('.a-price-whole').first().text().trim().replace(/[^\d]/g, '');
  const fraction = container.find('.a-price-fraction').first().text().trim().replace(/[^\d]/g, '');
  return whole ? `${whole}.${fraction || '00'}` : '';
}

async function scrapeAmazonProduct(url) {
  const html = await fetchWithRetry(url);
  const $ = cheerio.load(html);

  const title = $('#productTitle').text().trim() ||
    $('.qa-title-text').text().trim() ||
    $('title').text().replace('Amazon.com.br:', '').trim();

  if (!title || title.length < 5) {
    throw new Error('Titulo do produto nao encontrado ou muito curto.');
  }

  let currentPriceStr =
    $('.a-price.aok-align-center .a-offscreen').first().text().trim() ||
    $('.priceToPay .a-offscreen').first().text().trim() ||
    $('#corePriceDisplay_desktop_feature_div .a-price .a-offscreen').first().text().trim() ||
    $('.a-price.a-text-price.a-size-medium .a-offscreen').first().text().trim() ||
    $('#kindle-price').first().text().trim() ||
    $('#price_inside_buybox').first().text().trim() ||
    $('.a-color-price').first().text().trim();

  if (!currentPriceStr) {
    currentPriceStr =
      extractFromWholeFraction($('.a-price.aok-align-center')) ||
      extractFromWholeFraction($('.priceToPay')) ||
      extractFromWholeFraction($('#corePriceDisplay_desktop_feature_div .a-price'));
  }

  let oldPriceStr =
    $('.a-text-price[data-a-strike="true"] .a-offscreen').first().text().trim() ||
    $('#corePriceDisplay_desktop_feature_div .a-text-price[data-a-strike="true"] .a-offscreen').first().text().trim() ||
    $('.a-text-strike').first().text().trim() ||
    $('.priceBlockStrikePriceString').first().text().trim() ||
    $('#basisPrice .a-offscreen').first().text().trim() ||
    $('.basisPrice .a-offscreen').first().text().trim();

  if (!oldPriceStr) {
    oldPriceStr =
      extractFromWholeFraction($('.a-text-price[data-a-strike="true"]')) ||
      extractFromWholeFraction($('#corePriceDisplay_desktop_feature_div .a-text-price[data-a-strike="true"]')) ||
      extractFromWholeFraction($('#basisPrice')) ||
      extractFromWholeFraction($('.basisPrice'));
  }

  let image = '';
  const dynamicImageAttr = $('#landingImage').attr('data-a-dynamic-image') || $('#imgBlkFront').attr('data-a-dynamic-image');
  if (dynamicImageAttr) {
    try {
      const parsedImages = JSON.parse(dynamicImageAttr);
      image = Object.keys(parsedImages).sort((a, b) => {
        const sizeA = parsedImages[a][0] * parsedImages[a][1];
        const sizeB = parsedImages[b][0] * parsedImages[b][1];
        return sizeB - sizeA;
      })[0];
    } catch {}
  }

  if (!image) {
    image = $('#landingImage').attr('data-old-hires') ||
      $('#imgBlkFront').attr('data-old-hires') ||
      $('.a-dynamic-image').attr('data-old-hires');
  }

  if (!image || image.startsWith('data:image')) {
    image = $('#landingImage').attr('src') || $('#imgBlkFront').attr('src') || '';
  }

  if (!image || image.startsWith('data:image')) {
    image = $('meta[property="og:image"]').attr('content') || '';
  }

  if (image && image.includes('._')) {
    image = image.split('._')[0] + '.jpg';
  }

  const couponText = $('.s-coupon-highlight-color').text().trim() ||
    $('.s-coupon-unclipped').text().trim() ||
    $('#promoPriceBlockMessage_feature_div').text().trim() ||
    '';
  const badgeText = $('span[data-a-badge-color]').text().trim() || $('.a-badge-text').text().trim() || '';
  const affiliateLink = buildCleanAffiliateLink(url);
  if (!affiliateLink) {
    throw new Error('Falha ao processar ou extrair ASIN a partir da URL.');
  }

  const validation = validatePriceData({
    name: title,
    currentPrice: parsePrice(currentPriceStr),
    oldPrice: parsePrice(oldPriceStr),
    image: image || '',
    affiliateLink,
    coupon: couponText,
    badge: badgeText,
  });

  if (!validation.valid) {
    throw new Error(`[Scraper Validacao] Produto descartado: ${validation.reason}`);
  }

  return validation.cleanProduct;
}

async function expandUrl(url) {
  try {
    const response = await axios.get(url, {
      maxRedirects: 5,
      headers: { 'User-Agent': USER_AGENT },
    });
    return response.request.res.responseUrl || url;
  } catch (error) {
    if (error.response && error.response.request && error.response.request.res) {
      return error.response.request.res.responseUrl || url;
    }
    return url;
  }
}

async function scrapeLink(link) {
  console.log(`[Scraper] Raspagem manual de link: ${String(link).substring(0, 60)}...`);
  const finalUrl = await expandUrl(link);
  return scrapeAmazonProduct(finalUrl);
}

module.exports = {
  scrapeLink,
  scrapeAmazonProduct,
};
