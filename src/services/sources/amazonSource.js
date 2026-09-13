const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { queueProduct } = require('../../jobs/offerJob');
const searchSources = require('../../config/searchSources');
const { batchClassifyProducts } = require('../categoryClassifier');
const { validatePriceData } = require('../priceValidator');
const { buildCleanAffiliateLink } = require('../linkCleaner');

const statsFile = path.join(__dirname, '../../data/keywordStats.json');

// Funções de Memória
function loadStats() {
  if (fs.existsSync(statsFile)) {
    try { return JSON.parse(fs.readFileSync(statsFile, 'utf8')); } catch (e) { return {}; }
  }
  return {};
}

function saveStats(statsObj) {
  if (!fs.existsSync(path.dirname(statsFile))) {
    fs.mkdirSync(path.dirname(statsFile), { recursive: true });
  }
  fs.writeFileSync(statsFile, JSON.stringify(statsObj, null, 2));
}

// Inteligência de Sorteio Viciado
function getBestKeywords(category, count, statsObj, exclude = []) {
  const words = searchSources[category] || [];
  
  let rankedWords = words
    .filter(w => !exclude.includes(w))
    .map(w => {
      const s = statsObj[w] || { uses: 0, validFound: 0, lastUsed: 0 };
      // Se nunca foi usada, ganha chance alta pra ser testada. Se foi muito usada e deu ruim, perde peso.
      let winRate = s.uses > 0 ? (s.validFound / s.uses) : 50; 
      let timeSinceLastUse = Date.now() - s.lastUsed;
      // Bônus se faz muito tempo que não usa
      let recencyScore = Math.min(timeSinceLastUse / (1000 * 60 * 60), 20); 
      let randomBoost = Math.random() * 10;
      
      return { word: w, objScore: winRate + recencyScore + randomBoost };
    });
  
  rankedWords.sort((a, b) => b.objScore - a.objScore);
  return rankedWords.slice(0, count).map(r => r.word);
}

/**
 * Faz requisição com tentativas (retry) e cabeçalhos premium.
 */
async function fetchWithRetry(url, retries = 3) {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ];

  for (let i = 0; i < retries; i++) {
    try {
      const ua = userAgents[i % userAgents.length];
      const response = await axios.get(url, {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'Upgrade-Insecure-Requests': '1'
        },
        timeout: 10000,
        validateStatus: status => status === 200
      });
      console.log(`[AutoScraper Fast] Sucesso! Acesso à Amazon liberado.`);
      return response.data;
    } catch (err) {
      console.log(`[AutoScraper Fast] Amazon bloqueou 503 ou Timeout. Tentando novo disfarce (${i+1}/3)...`);
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  throw new Error('Bloqueio persistente 503 na busca Amazon');
}

async function runWithConcurrency(tasks, limit) {
  const results = [];
  const executing = [];
  for (const task of tasks) {
    const p = Promise.resolve().then(() => task());
    results.push(p);
    if (limit <= tasks.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

async function runAutoScraper() {
  console.log('\n[AutoScraper Fast] Iniciando operação com Sorteio Inteligente e IA...');
  
  let statsObj = loadStats();
  
  let stats = {
    urlsTried: 0,
    urlsFailed: 0,
    rawProducts: 0,
    discardedNoPrice: 0,
    discardedNoTitle: 0,
    discardedNoDeal: 0,
    discardedByAI: 0,
    validProducts: 0
  };

  const tasks = [];
  const extractedBuffer = []; // Guarda todos os produtos brutos para mandar pro Gemini
  
  // Para cada categoria, queremos 2 palavras que tragam resultados.
  // Se uma falhar, tentamos outra internamente.
  for (const category of Object.keys(searchSources)) {
    
    // A tarefa interna que gerencia a resiliência por categoria
    tasks.push(async () => {
      let successCount = 0;
      let usedWords = [];
      
      // Tenta buscar até conseguir sucesso em 2 palavras diferentes, com limite de 4 tentativas pra não travar
      for (let attempt = 0; attempt < 4; attempt++) {
        if (successCount >= 2) break; // Já achou o que precisava
        
        const bestWords = getBestKeywords(category, 1, statsObj, usedWords);
        if (bestWords.length === 0) break;
        
        const keyword = bestWords[0];
        usedWords.push(keyword);
        
        // Atualiza memória (lastUsed)
        if (!statsObj[keyword]) statsObj[keyword] = { uses: 0, validFound: 0, lastUsed: 0 };
        statsObj[keyword].uses += 1;
        statsObj[keyword].lastUsed = Date.now();
        
        console.log(`[AutoScraper Fast] Buscando: "${keyword}"...`);
        const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(keyword)}&pct-off=10-`;
        stats.urlsTried++;
        
        try {
          const html = await fetchWithRetry(url);
          const $ = cheerio.load(html);
          const items = $('div[data-component-type="s-search-result"]');
          
          let foundInThisKeyword = 0;
          
          items.each((i, element) => {
            if (foundInThisKeyword >= 15) return; // Limita a 15 produtos bons por keyword
            stats.rawProducts++;
            const el = $(element);
            
            const title = el.find('h2').text().trim();
            let link = el.find('h2 a').attr('href') || el.find('h2').closest('a').attr('href') || el.find('a.a-link-normal.s-no-outline').attr('href') || el.find('a.a-link-normal').attr('href');
            
            if (!title || !link) { stats.discardedNoTitle++; return; }
            if (!link.startsWith('http')) link = 'https://www.amazon.com.br' + link;
            
            // Monta link limpo no formato /dp/ASIN?tag=
            const affiliateLink = buildCleanAffiliateLink(link);
            if (!affiliateLink) { stats.discardedNoTitle++; return; }
            
            const currentPriceStr = el.find('.a-price .a-offscreen').first().text().trim();
            const oldPriceStr = el.find('.a-text-price[data-a-strike="true"] .a-offscreen').first().text().trim() || el.find('.a-text-strike').first().text().trim();
            const rawImage = el.find('.s-image').attr('src') || '';
            const image = rawImage.includes('._') ? rawImage.split('._')[0] + '.jpg' : rawImage;
            
            // Novos seletores de Oferta Visual
            const couponText = el.find('.s-coupon-highlight-color').text().trim() || el.find('.s-coupon-unclipped').text().trim() || '';
            const badgeText = el.find('span[data-a-badge-color]').text().trim() || el.find('.a-badge-text').text().trim() || '';
            
            // Prepara objeto preliminar para enviar para o priceValidator centralizado
            const productRaw = {
              name: title,
              currentPrice: currentPriceStr,
              oldPrice: oldPriceStr,
              coupon: couponText,
              badge: badgeText,
              image: image,
              affiliateLink: affiliateLink,
              keywordSource: keyword
            };

            const validation = validatePriceData(productRaw);
            if (!validation.valid) {
              if (validation.reason.includes('preço cheio') || validation.reason.includes('Sem desconto')) {
                stats.discardedNoDeal++;
              } else {
                stats.discardedNoPrice++;
              }
              // Log informativo do descarte
              console.log(`[Validador Preço] 🚫 Descartado: "${title.substring(0, 45)}...". Motivo: ${validation.reason}`);
              return;
            }

            const cleanProduct = validation.cleanProduct;
            
            // Sistema de Pontuação Agressivo
            let score = 10; 
            if (cleanProduct.image) score += 10;
            if (cleanProduct.discount > 0) score += (cleanProduct.discount * 2); // 50% de desconto = +100 pontos
            if (couponText) score += 30; 
            if (badgeText.toLowerCase().includes('oferta') || badgeText.toLowerCase().includes('promo')) score += 40; 
            if (badgeText.toLowerCase().includes('relâmpago')) score += 50; 
            
            cleanProduct.score = score;
            
            extractedBuffer.push(cleanProduct);
            foundInThisKeyword++;
          });
          
          if (foundInThisKeyword > 0) {
            successCount++; // Essa keyword foi um sucesso
          } else {
            console.log(`[AutoScraper Fast] A busca "${keyword}" não trouxe nada. Acionando próxima palavra...`);
          }
          
        } catch (err) {
          stats.urlsFailed++;
          console.log(`[AutoScraper Fast] Falha na palavra "${keyword}". Substituindo automaticamente...`);
        }
      }
    });
  }

  // Roda todas as tarefas de categoria com limite de concorrência seguro
  // Limite 4 = 4 buscas simultâneas
  await runWithConcurrency(tasks, 4);
  
  if (extractedBuffer.length > 0) {
    console.log(`\n[Inteligência Artificial] Chamando Gemini para analisar ${extractedBuffer.length} produtos em Lote...`);
    const classifiedList = await batchClassifyProducts(extractedBuffer);
    
    // Distribui nas gavetas e atualiza memória
    for (const prod of classifiedList) {
      if (prod.category === 'Outros') {
        stats.discardedByAI++;
        continue;
      }
      
      const queued = queueProduct(prod, prod.category); // Força a categoria que a IA escolheu
      if (queued) {
        stats.validProducts++;
        // Recompensa a palavra-chave que trouxe esse produto
        if (statsObj[prod.keywordSource]) {
          statsObj[prod.keywordSource].validFound += 1;
        }
      }
    }
  }
  
  // Salva a memória para a próxima rodada
  saveStats(statsObj);
  
  console.log(`\n[AutoScraper Fast] === RELATÓRIO FINAL ===`);
  console.log(`- URLs Tentadas: ${stats.urlsTried}`);
  console.log(`- URLs Falhas (503): ${stats.urlsFailed}`);
  console.log(`- Produtos Brutos Pescados: ${stats.rawProducts}`);
  console.log(`- Lixo: Descartados (Sem Preço ou Inconsistente): ${stats.discardedNoPrice}`);
  console.log(`- Lixo: Descartados (Sem Título): ${stats.discardedNoTitle}`);
  console.log(`- Lixo: Descartados (Preço Cheio/Sem Oferta): ${stats.discardedNoDeal}`);
  console.log(`- Lixo: Bloqueados pela IA: ${stats.discardedByAI}`);
  console.log(`- ✅ PRODUTOS PREMIUM APROVADOS: ${stats.validProducts}\n`);
  
  return stats.validProducts;
}

module.exports = {
  runAutoScraper
};
