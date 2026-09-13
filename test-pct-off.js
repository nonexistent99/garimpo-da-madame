const axios = require('axios');
const cheerio = require('cheerio');
const { validatePriceData } = require('./src/services/priceValidator');
const { buildCleanAffiliateLink } = require('./src/services/linkCleaner');

async function testKeyword(keyword) {
  const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(keyword)}&pct-off=10-`;
  console.log(`[Test] Buscando: ${keyword} com url: ${url}`);
  
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  ];

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': userAgents[0],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const items = $('div[data-component-type="s-search-result"]');
    
    console.log(`[Test] Total de itens retornados pela busca Amazon: ${items.length}`);
    
    let validCount = 0;
    items.each((i, element) => {
      const el = $(element);
      const title = el.find('h2').text().trim();
      let link = el.find('h2 a').attr('href') || el.find('a.a-link-normal').attr('href') || '';
      
      const currentPriceStr = el.find('.a-price .a-offscreen').first().text().trim();
      const oldPriceStr = el.find('.a-text-price[data-a-strike="true"] .a-offscreen').first().text().trim() || el.find('.a-text-strike').first().text().trim();
      const couponText = el.find('.s-coupon-highlight-color').text().trim() || '';
      const badgeText = el.find('span[data-a-badge-color]').text().trim() || el.find('.a-badge-text').text().trim() || '';

      const productRaw = {
        name: title,
        currentPrice: currentPriceStr,
        oldPrice: oldPriceStr,
        coupon: couponText,
        badge: badgeText
      };

      const validation = validatePriceData(productRaw);
      if (validation.valid) {
        validCount++;
        console.log(`✅ APROVADO: "${title.substring(0, 50)}..."`);
        console.log(`   Preço Atual: R$ ${validation.cleanProduct.currentPrice} | Preço Antigo: R$ ${validation.cleanProduct.oldPrice} | Desconto: ${validation.cleanProduct.discount}%`);
      } else {
        console.log(`❌ DESCARTADO: "${title.substring(0, 50)}..." - Motivo: ${validation.reason}`);
      }
    });

    console.log(`\n[Test] Saldo final: ${validCount} produtos aprovados.`);
  } catch (err) {
    console.error('[Test] Erro na busca:', err.message);
  }
}

testKeyword('teclado gamer');
