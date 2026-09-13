const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const db = require('../database/database');
const { classifyProduct, sanitizeCategory } = require('../services/categoryClassifier');
const { generateMessage } = require('../services/messageGenerator');
const { sendToTelegram } = require('../services/telegramService');
const { addToWhatsAppQueue } = require('../services/whatsappQueueService');
const { validatePriceData } = require('../services/priceValidator');
const { buildCleanAffiliateLink, extractAsin } = require('../services/linkCleaner');

// Sistema de Múltiplas Filas
const queues = {
  'Gamer': [],
  'Cozinha': [],
  'Eletrônicos': [],
  'Beleza feminina': [],
  'Pet': [],
  'Leitura': [],
  'Academia_Fitness': [],
  'Mobile_Games': [],
  'Todos': []
};

// Rastreia os últimos tipos de produtos enviados por categoria (para forçar variedade)
const lastSentTypes = {}; // { 'Cozinha': ['torradeira', 'air fryer', 'cafeteira'], ... }

// Inicialização e Migração — agora ESPERA o DB estar pronto
async function initMigrations() {
  try {
    // Aguarda o DB criar as tabelas + adicionar colunas + seed
    await db.ready;
    console.log('[SQLite Migrações] 🛠️  DB pronto. Rodando backfill e limpeza...');

    // 1. Backfill de asin/title_hash para registros antigos
    await backfillSentProducts();

    // 2. Limpa registros duplicados do histórico (mesma chave dedup)
    try {
      await db.runQuery(`
        DELETE FROM sent_products
        WHERE id NOT IN (
          SELECT MIN(id)
          FROM sent_products
          GROUP BY COALESCE(asin, title_hash, name), niche
        )
      `);
    } catch (e) {
      console.error('[SQLite Migrações] Aviso ao limpar histórico:', e.message);
    }

    console.log('[SQLite Migrações] ✅ Migrações de dados concluídas.');
  } catch (err) {
    console.error('[SQLite Migrações] Erro crítico:', err.message);
  }
}

/**
 * Preenche retroativamente os campos 'asin' e 'title_hash' para registros antigos.
 */
async function backfillSentProducts() {
  try {
    const rows = await db.getQuery(
      'SELECT id, name, affiliate_link FROM sent_products WHERE asin IS NULL OR title_hash IS NULL'
    );

    if (rows.length === 0) {
      return;
    }

    console.log(`[SQLite Migrações] 🔄 Realizando preenchimento retroativo (backfill) de ${rows.length} ofertas antigas...`);
    
    for (const row of rows) {
      const { asin, titleHash } = normalizeProductIdentity(row.name, row.affiliate_link);
      await db.runQuery(
        'UPDATE sent_products SET asin = ?, title_hash = ? WHERE id = ?',
        [asin, titleHash, row.id]
      );
    }
    console.log('[SQLite Migrações] ✅ Backfill concluído com sucesso!');
  } catch (err) {
    console.error('[SQLite Migrações] Erro ao executar backfill:', err.message);
  }
}

/**
 * Normaliza a identidade de um produto baseado no ASIN e num hash simplificado do título.
 * Elimina cores, voltagens, pesos, tamanhos e stop words para colapsar variantes.
 * @param {string} productName 
 * @param {string} affiliateLink 
 * @returns {object} { asin: string|null, titleHash: string }
 */
function normalizeProductIdentity(productName, affiliateLink) {
  // 1. Extrai o ASIN da URL
  const asin = extractAsin(affiliateLink);

  // 2. Normalização do Título (Filtro de Variações de Produto Agressivo)
  let titleHash = '';
  if (productName) {
    const stopWords = new Set([
      'de', 'com', 'para', 'em', 'por', 'do', 'da', 'no', 'na', 'e', 'a', 'o', 'un', 'und', 'kit', 'jogo', 'par', 'novo', 'nova',
      'preto', 'preta', 'verde', 'azul', 'branco', 'branca', 'rosa', 'vermelho', 'vermelha', 'cinza', 'prata', 'dourado', 'dourada', 'marfim',
      '110v', '220v', 'bivolt', 'volts', 'volt', 'ml', 'g', 'kg', 'l', 'litros', 'litro', 'mm', 'polegadas'
    ]);
    
    // Normalização inicial do texto
    let clean = productName.toLowerCase();
    
    // Remove unidades de medida, capacidade, peso e voltagens comuns (ex: 64gb, 15kg, 110v, 20cm, 7200 dpi)
    clean = clean.replace(/\b\d+\s*(gb|g|kg|ml|l|cm|mm|w|v|mah|in|tb|fps|hz|dpi)\b/gi, ' ');
    
    // Remove capacidades de armazenamento/memória avulsas típicas de variação (ex: 64, 128, 256, 512)
    clean = clean.replace(/\b(64|128|256|512)\b/gi, ' ');
    
    // Remove acentos e substitui pontuações por espaços
    clean = clean
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\sÀ-ÿ]/g, ' ')
      .trim();
      
    const words = clean.split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));
    
    // Usa as primeiras 4 palavras mais significativas
    const significantWords = words.slice(0, 4);
    
    // Ordena alfabeticamente para evitar duplicação por mudança de ordem
    significantWords.sort();
    
    titleHash = significantWords.join('_');
  }

  return { asin, titleHash };
}

// Calcula similaridade de Jaccard entre dois conjuntos de palavras (usado para comparação em RAM)
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

// Extrai palavras significativas do nome
function getSignificantWords(name) {
  if (!name) return new Set();
  const stopWords = new Set(['de', 'com', 'para', 'em', 'por', 'do', 'da', 'no', 'na', 'e', 'a', 'o', 'un', 'und']);
  const words = name.replace(/[^\w\sÀ-ÿ]/g, '').trim().split(/\s+/).map(w => w.toLowerCase());
  return new Set(words.filter(w => w.length > 1 && !stopWords.has(w)));
}

/**
 * Verifica se um produto já foi postado anteriormente na história do bot (SQLite).
 * Utiliza o ASIN e o Title Hash como chaves de deduplicação absoluta.
 * @param {string} productName 
 * @param {string} affiliateLink 
 * @param {string} niche 
 * @returns {Promise<boolean>} True se for duplicado
 */
async function isAlreadySent(productName, affiliateLink, niche) {
  const { asin, titleHash } = normalizeProductIdentity(productName, affiliateLink);

  // 1. Deduplicação por ASIN (Chave Primária)
  if (asin) {
    const existingAsin = await db.getQuery(
      'SELECT id FROM sent_products WHERE asin = ? AND niche = ?',
      [asin, niche]
    );
    if (existingAsin.length > 0) return true;
  }

  // 2. Deduplicação por Title Hash (Chave Secundária para Variantes de anúncio/link diferente)
  if (titleHash) {
    const existingTitleHash = await db.getQuery(
      'SELECT id FROM sent_products WHERE title_hash = ? AND niche = ?',
      [titleHash, niche]
    );
    if (existingTitleHash.length > 0) return true;
  }

  return false;
}

/**
 * Verifica se já existe uma variante similar na fila de RAM local para evitar envio repetido no mesmo ciclo.
 */
function isVariantInQueue(productName, targetQueue) {
  if (!targetQueue || targetQueue.length === 0) return false;
  const currentWords = getSignificantWords(productName);
  if (currentWords.size < 2) return false;
  
  return targetQueue.some(p => {
    const queueWords = getSignificantWords(p.name);
    return jaccardSimilarity(currentWords, queueWords) >= 0.5; // 50% de sobreposição na RAM
  });
}

/**
 * Salva o produto no histórico de enviados para nunca mais ser postado.
 */
async function markAsSent(productName, affiliateLink, niche) {
  try {
    const { asin, titleHash } = normalizeProductIdentity(productName, affiliateLink);
    await db.runQuery(
      'INSERT INTO sent_products (name, affiliate_link, niche, asin, title_hash) VALUES (?, ?, ?, ?, ?)',
      [productName, affiliateLink, niche, asin, titleHash]
    );
  } catch (err) {
    // Silencia se der erro de unique constraint
  }
}

// Dispara uma oferta para um canal específico e salva no WhatsApp
async function dispatchToCategory(product, niche) {
  const message = await generateMessage(product, niche);
  await sendToTelegram(message, product.image, niche);
  await addToWhatsAppQueue(product.name, message, niche, product.image);
}

// Extrai o tipo do produto: a primeira palavra significativa do nome
function extractProductType(name) {
  if (!name) return '';
  const stopWords = new Set(['de', 'com', 'para', 'em', 'por', 'do', 'da', 'no', 'na', 'e', 'a', 'o', 'kit', 'jogo', 'par', 'novo', 'nova']);
  const words = name.replace(/[^\w\sÀ-ÿ]/g, '').trim().split(/\s+/).map(w => w.toLowerCase());
  const significant = words.filter(w => w.length > 2 && !stopWords.has(w));
  return significant[0] || '';
}

// Roda a cada 10 minutos pelo cron principal: Despacha 1 oferta por categoria
async function dispatchNextRound() {
  console.log('\n[Dispatcher] === Iniciando rodada de envios (10 min) ===');
  
  const targetCategories = ['Gamer', 'Cozinha', 'Eletrônicos', 'Beleza feminina', 'Pet', 'Leitura', 'Academia_Fitness', 'Mobile_Games'];
  
  for (const cat of targetCategories) {
    if (queues[cat].length === 0) {
      console.log(`[Dispatcher] 💭 Gaveta de ${cat} está vazia neste momento.`);
      continue;
    }

    const recentTypes = lastSentTypes[cat] || [];
    
    // Avalia score balanceado incluindo o bônus de variedade de tipo de produto
    const scoredQueue = queues[cat].map(p => {
      const discountScore = (p.discount || 0) * 0.5;
      const imageBonus = p.image ? 10 : 0;
      
      const productType = p.keywordSource ? p.keywordSource.toLowerCase() : extractProductType(p.name);
      let typeBonus = 0;
      if (recentTypes.includes(productType)) {
        typeBonus = -100; // Penalidade forte para repetições
      } else {
        typeBonus = 50;   // Bônus para incentivar variedade rotativa
      }
      
      return { ...p, balancedScore: discountScore + typeBonus + imageBonus, _productType: productType };
    });
    
    // Ordena pelo score
    scoredQueue.sort((a, b) => b.balancedScore - a.balancedScore);
    
    // Procura o primeiro produto na fila ordenada que ainda não foi enviado
    let chosenProduct = null;
    
    for (const p of scoredQueue) {
      const sent = await isAlreadySent(p.name, p.affiliateLink, cat);
      if (!sent) {
        chosenProduct = p;
        break;
      } else {
        // Limpa o obsoleto da fila RAM global
        const idx = queues[cat].findIndex(item => item.affiliateLink === p.affiliateLink);
        if (idx !== -1) queues[cat].splice(idx, 1);
        console.log(`[Dispatcher - Limpeza] 🗑️ Removido item obsoleto da fila RAM: "${p.name.substring(0, 45)}..."`);
      }
    }
    
    if (!chosenProduct) {
      console.log(`[Dispatcher] 💭 Nenhum produto não-enviado disponível na gaveta de ${cat}.`);
      continue;
    }
    
    // Remove o produto escolhido da fila RAM global
    const idx = queues[cat].findIndex(p => p.affiliateLink === chosenProduct.affiliateLink);
    if (idx !== -1) queues[cat].splice(idx, 1);
    
    const pType = chosenProduct._productType || extractProductType(chosenProduct.name);
    console.log(`[Dispatcher] 🚀 ENVIANDO -> ${cat} | Desconto: ${chosenProduct.discount}% | Tipo: ${pType} | Score: ${Math.round(chosenProduct.balancedScore)} | ${chosenProduct.name.substring(0, 50)}`);
    
    await dispatchToCategory(chosenProduct, cat);
    await markAsSent(chosenProduct.name, chosenProduct.affiliateLink, cat);
    
    // Memoriza o tipo na lista de variedades recente
    if (!lastSentTypes[cat]) lastSentTypes[cat] = [];
    lastSentTypes[cat].push(pType);
    if (lastSentTypes[cat].length > 3) lastSentTypes[cat].shift();
  }
  
  console.log('[Dispatcher] === Rodada finalizada ===\n');
}

/**
 * Processa e coloca o produto na gaveta correspondente, aplicando validações rígidas.
 * @param {object} product Dados brutos do produto
 * @param {string|null} forcedNiche Gaveta forçada (opcional)
 * @returns {boolean} True se foi aceito e enfileirado
 */
function queueProduct(product, forcedNiche = null) {
  if (!product || !product.name || !product.affiliateLink) {
    console.warn('[Fila] 🚫 Produto rejeitado (dados obrigatórios ausentes)');
    return false;
  }

  // 1. VALIDAÇÃO DE PREÇO RÍGIDA (centralizada no priceValidator)
  // Garante que mesmo inserções CSV/JSON e manuais fiquem sob a mesma regra rígida
  const priceValidation = validatePriceData(product);
  if (!priceValidation.valid) {
    console.log(`[Fila - Rejeição Preço] 🚫 "${product.name.substring(0, 45)}...": ${priceValidation.reason}`);
    return false;
  }

  const cleanProduct = priceValidation.cleanProduct;

  // 2. HIGIENIZAÇÃO DE CATEGORIAS
  let niche = forcedNiche;
  if (!niche) {
    if (cleanProduct.category && cleanProduct.category !== 'Todos' && cleanProduct.category !== 'Outros') {
      niche = cleanProduct.category;
    } else {
      const offlineRes = classifyProduct(cleanProduct.name);
      niche = offlineRes.category;
    }
  }

  // Roda sanitização final rígida e unificada de categorias
  niche = sanitizeCategory(cleanProduct, niche);
  cleanProduct.category = niche;

  console.log(`[Fila - Classificação Final] Gaveta: "${niche}" | "${cleanProduct.name.substring(0, 50)}..."`);

  // 3. ENFILEIRAMENTO RESILIENTE (Com suporte a multi-gavetas se for exceções)
  function pushToQueueIfUnique(prod, cat) {
    if (!queues[cat]) return;
    if (isVariantInQueue(prod.name, queues[cat])) {
      console.log(`[Fila - RAM] 🚫 Variante já enfileirada na gaveta ${cat}: "${prod.name.substring(0, 45)}..."`);
      return;
    }
    queues[cat].push({ ...prod, category: cat });
  }

  const nameLower = cleanProduct.name.toLowerCase();
  const isHeadset = nameLower.includes('headset');
  const isEarbudOrAirpod = (nameLower.includes('fone') || nameLower.includes('earbud') || nameLower.includes('airpod')) && !nameLower.includes('pet') && !nameLower.includes('cachorro') && !nameLower.includes('gato');
  const isControleVideogame = nameLower.includes('controle') && (nameLower.includes('ps') || nameLower.includes('playstation') || nameLower.includes('xbox') || nameLower.includes('nintendo') || nameLower.includes('videogame'));
  const isComputadorOrNotebook = /\b(notebook|laptop|macbook|computador|pc gamer|desktop)\b/i.test(cleanProduct.name);
  const isTablet = /\b(tablet|ipad|galaxy tab)\b/i.test(cleanProduct.name);

  if (isHeadset) {
    pushToQueueIfUnique(cleanProduct, 'Gamer');
  } else if (isEarbudOrAirpod) {
    pushToQueueIfUnique(cleanProduct, 'Gamer');
    pushToQueueIfUnique(cleanProduct, 'Eletrônicos');
  } else if (isControleVideogame) {
    pushToQueueIfUnique(cleanProduct, 'Gamer');
    pushToQueueIfUnique(cleanProduct, 'Mobile_Games');
  } else if (isComputadorOrNotebook) {
    pushToQueueIfUnique(cleanProduct, 'Gamer');
    pushToQueueIfUnique(cleanProduct, 'Mobile_Games');
  } else if (isTablet) {
    pushToQueueIfUnique(cleanProduct, 'Eletrônicos');
    pushToQueueIfUnique(cleanProduct, 'Mobile_Games');
  } else if (queues[niche]) {
    pushToQueueIfUnique(cleanProduct, niche);
  } else {
    pushToQueueIfUnique(cleanProduct, 'Eletrônicos'); // Gaveta catch-all padrão seguro
  }

  return true;
}

// Carregadores de arquivos para injeção manual
function loadFromJson() {
  try {
    const filePath = path.join(__dirname, '../../data/products.json');
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const products = JSON.parse(data);
      console.log(`[Arquivos JSON] Lendo ${products.length} produtos do JSON.`);
      products.forEach(p => queueProduct(p));
    }
  } catch (error) {
    console.error('Erro ao ler products.json:', error.message);
  }
}

function loadFromCsv() {
  try {
    const filePath = path.join(__dirname, '../../data/products.csv');
    if (fs.existsSync(filePath)) {
      let count = 0;
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          queueProduct(row);
          count++;
        })
        .on('end', () => {
          console.log(`[Arquivos CSV] Lendo ${count} produtos do CSV.`);
        });
    }
  } catch (error) {
    console.error('Erro ao ler products.csv:', error.message);
  }
}

function runJobs() {
  console.log('[Arquivos] Lendo e injetando arquivos locais...');
  loadFromJson();
  loadFromCsv();
}

// Inicializa a migração na carga do módulo de forma assíncrona segura
initMigrations();

module.exports = {
  queueProduct,
  runJobs,
  dispatchNextRound,
  queues,
  normalizeProductIdentity
};
