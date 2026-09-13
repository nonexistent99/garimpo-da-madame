const { GoogleGenerativeAI } = require('@google/generative-ai');
const searchSources = require('../config/searchSources');

let genAI = null;

function getGenAI() {
  if (!genAI && process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(genAI);
  }
  return genAI;
}

/**
 * Identifica a qual categoria pertence uma determinada palavra-chave de busca
 */
function getSearchCategoryOfKeyword(keyword) {
  if (!keyword) return null;
  const normalizedKeyword = keyword.toLowerCase().trim();
  for (const [cat, words] of Object.entries(searchSources)) {
    if (words.some(w => w.toLowerCase().trim() === normalizedKeyword)) {
      return cat;
    }
  }
  return null;
}

/**
 * Remove acentos e normaliza texto para facilitar buscas de palavras.
 * @param {string} text 
 * @returns {string} Texto normalizado em ASCII minúsculo
 */
function normalizeText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^\w\s]/g, ' ') // substitui pontuação por espaços
    .trim();
}

/**
 * Filtro Sanitizador Rígido Determinístico (Filtro Antierro de IA/Offline).
 * Garante que produtos específicos de certas categorias NUNCA vão para gavetas erradas.
 * @param {object} product Objeto de produto
 * @param {string} currentCategory Categoria atualmente atribuída
 * @returns {string} Categoria final higienizada
 */
function sanitizeCategory(product, currentCategory) {
  const rawName = product.name || '';
  const rawHint = product.keywordSource || '';
  
  const name = normalizeText(rawName);
  const hint = normalizeText(rawHint);

  // ─── 0. REGRA MESTRA: HEADSET E FONES GAMER ───
  // Headsets e fones especificamente voltados para gamer sempre vão para GAMER,
  // mesmo que mencionem compatibilidade com PS4, PS5, Xbox, etc.
  if (name.includes('headset') || name.includes('fone gamer')) {
    return 'Gamer';
  }

  // ─── 0.1. REGRA: RELÓGIOS, SMARTWATCHES E SMARTBANDS ───
  // Relógios, smartwatches, smartbands e acessórios como pulseiras/straps sempre vão para Eletrônicos para evitar irem para Academia/Fitness ou Mobile_Games
  const isWatch = name.includes('smartwatch') || name.includes('smartband') || 
                  name.includes('relogio') || name.includes('watch') || 
                  name.includes('pulseira') || name.includes('pulseiras') || 
                  name.includes('strap') || name.includes('band') || 
                  /\b(relogio|smartband|smartwatch|watch|pulseira|strap)\b/.test(name);
  if (isWatch) {
    return 'Eletrônicos';
  }

  // ─── 1. REGRA: LEITURA (Kindles e Livros físicos/eBooks) ───
  const readingTerms = [
    /\bkindle\b/, /\blivro\b/, /\bebook\b/, /\bcolecao livros\b/, /\bbox livros\b/,
    /\bmanga\b/, /\bquadrinhos\b/, /\bhq\b/, /\brevista\b/, /\bnovela\b/,
    /\bbiografia\b/, /\bautoajuda\b/, /\bliteratura\b/, /\bedicao ilustrada\b/,
    /\bcapa comum\b/, /\bcapa dura\b/, /\beditora\b/, /\bprodutividade\b/,
    /\bdesenvolvimento pessoal\b/, /\binteligencia emocional\b/, /\bhabitos\b/
  ];
  let isReading = readingTerms.some(regex => regex.test(name) || regex.test(hint));
  
  // Se a palavra-chave de origem for categorizada como Leitura, e não for tecnologia óbvia, assume Leitura
  const keywordCat = getSearchCategoryOfKeyword(rawHint);
  if (keywordCat === 'Leitura' && !name.includes('luminaria') && !name.includes('suporte')) {
    isReading = true;
  }
  
  // Anti-Falso Positivo para TVs/Monitores e produtos de informática da marca HQ (ex: Smart TV HQ, Monitor HQ)
  if (name.includes('hq') && /\b(tv|television|smart|monitor|screen|painel|led|lcd|teclado|pc|notebook)\b/.test(name)) {
    isReading = false;
  }
  
  if (isReading) {
    if (!name.includes('brinquedo pet') && !name.includes('racao')) {
      return 'Leitura';
    }
  }

  // ─── 2. REGRA: MOBILE GAMES (Celulares, Consoles e Controles de videogame originais) ───
  const mobileGamesTerms = [
    /\biphone\b/, /\bsamsung galaxy\b/, /\bxiaomi\b/, /\bredmi\b/, /\bmotorola moto\b/,
    /\bpoco\b/, /\bcelular\b/, /\bsmartphone\b/, /\bps5\b/, /\bplaystation\b/, /\bps4\b/,
    /\bxbox\b/, /\bnintendo switch\b/, /\bsteam deck\b/, /\bgame boy\b/,
    /\bdualsense\b/, /\bdualshock\b/, /\bcontrole sem fio xbox\b/, /\bcontrole nintendo switch\b/
  ];
  // Filtros negativos para Mobile_Games (acessórios secundários vão para Eletrônicos)
  const isMobileGamesNegative = /\b(capa|pelicula|case|suporte para celular|suporte de parede|adesivo|pingente|cabo usb|carregador)\b/.test(name);
  
  const isMobileGame = mobileGamesTerms.some(regex => regex.test(name) || regex.test(hint));
  if (isMobileGame && !isMobileGamesNegative) {
    return 'Mobile_Games';
  }

  // ─── 3. REGRA: PET (Ração, petiscos, brinquedos pet e antipulgas) ───
  const petTerms = [
    /\bracao\b/, /\bpetisco\b/, /\bcachorro\b/, /\bgato\b/, /\bpet\b/, /\bcoleira\b/,
    /\bcomedouro\b/, /\bantipulgas\b/, /\bdefenza\b/, /\bbravecto\b/, /\bshampoo pet\b/,
    /\bbrinquedo pet\b/, /\bcama pet\b/, /\barranhador\b/, /\btapete higienico\b/,
    /\bcaixa de transporte\b/, /\bcaes\b/
  ];
  let isPet = petTerms.some(regex => regex.test(name) || regex.test(hint));
  
  // Anti-Falso Positivo para a expressão idiomática "pulo do gato" (livros de negócios/soft skills)
  if (name.includes('pulo do gato')) {
    isPet = false;
  }
  
  if (isPet) {
    return 'Pet';
  }

  // ─── 4. REGRA: ACADEMIA & FITNESS (Suplementos, halteres, vestuário fitness) ───
  const fitnessTerms = [
    /\bwhey\b/, /\bcreatina\b/, /\bpre treino\b/, /\bsuplemento\b/, /\bhalteres\b/,
    /\banilha\b/, /\bcoqueteleira\b/, /\bfit\b/, /\bfitness\b/,
    /\bacacademia\b/, /\btreino\b/, /\belastico treino\b/, /\bgripped\b/, /\bdry fit\b/,
    /\blegging\b/, /\bcolchonete academia\b/, /\bcorda pular\b/
  ];
  if (fitnessTerms.some(regex => regex.test(name) || regex.test(hint))) {
    return 'Academia_Fitness';
  }

  // ─── 5. REGRA: BELEZA FEMININA (Skincare, maquiagem, perfumes, modeladores) ───
  const beautyTerms = [
    /\bmaquiagem\b/, /\bbatom\b/, /\bskincare\b/, /\bsecador\b/, /\bchapinha\b/,
    /\bescova rotativa\b/, /\bperfume feminino\b/, /\bcreme facial\b/, /\bserum\b/,
    /\bprotetor solar\b/, /\bblush\b/, /\brimel\b/, /\bpaleta sombra\b/, /\bhidratante facial\b/
  ];
  const isBeautyNegative = /\b(racao|livro|notebook|geladeira|panela)\b/.test(name);
  if (beautyTerms.some(regex => regex.test(name) || regex.test(hint)) && !isBeautyNegative) {
    return 'Beleza feminina';
  }

  // ─── 6. REGRA: COZINHA (Eletros de cozinha e utensílios pequenos) ───
  const kitchenTerms = [
    /\bpanela\b/, /\bair fryer\b/, /\bfritadeira\b/, /\bliquidificador\b/, /\bcafeteira\b/,
    /\bmixer\b/, /\bbatedeira\b/, /\bpote hermetico\b/, /\btalheres\b/,
    /\bchaleira\b/, /\btorradeira\b/, /\bsanduicheira\b/,
    /\bfrigideira\b/, /\bwok\b/, /\bassadeira\b/, /\butensilio cozinha\b/, /\btabua corte\b/,
    /\bfaca cozinha\b/, /\bporta tempero\b/, /\bcuscuzeiro\b/
  ];
  const isKitchenNegative = /\b(racao|livro|suplemento|shampoo|creatina|whey|coleira|pet)\b/.test(name);
  if (kitchenTerms.some(regex => regex.test(name) || regex.test(hint)) && !isKitchenNegative) {
    return 'Cozinha';
  }

  // ─── 7. REGRA: GAMER (Setup de PC, teclados/mouses mecânicos, headsets, hardware) ───
  const gamerTerms = [
    /\bgamer\b/, /\brgb\b/, /\bteclado mecanico\b/, /\bmouse gamer\b/,
    /\bmonitor 144hz\b/, /\bmonitor gamer\b/, /\bcadeira gamer\b/, /\bpc gamer\b/,
    /\bplaca de video\b/, /\brtx\b/, /\bplaca mae\b/, /\bmemoria ram\b/, /\bssd gamer\b/,
    /\bgabinete gamer\b/, /\bmousepad gamer\b/
  ];
  if (gamerTerms.some(regex => regex.test(name) || regex.test(hint))) {
    return 'Gamer';
  }

  // ─── 8. REGRA: ELETRÔNICOS (Catch-all de Tecnologia geral e Eletrodomésticos Grandes) ───
  const electronicsTerms = [
    /\bfone bluetooth\b/, /\bfone de ouvido\b/, /\bsmartwatch\b/, /\brelogio smartwatch\b/,
    /\btelevision\b/, /\btv smart\b/, /\btelevision smart\b/, /\bar condicionado\b/,
    /\becho dot\b/, /\balexa\b/, /\bcaixa de som\b/, /\bcarregador\b/, /\bcabo usb\b/,
    /\bpower bank\b/, /\btablet\b/, /\bipad\b/, /\bhd externo\b/, /\bssd\b/, /\bpendrive\b/,
    /\btv\b/, /\bmicro ondas\b/, /\bmicroondas\b/, /\bgeladeira\b/, /\bforno eletrico\b/, /\bmaquina de lavar\b/
  ];
  if (electronicsTerms.some(regex => regex.test(name) || regex.test(hint))) {
    return 'Eletrônicos';
  }

  // Se passou por todas as regras estritas e não deu match, respeita a categoria atual (se for válida)
  const validCategories = new Set(['Gamer', 'Cozinha', 'Eletrônicos', 'Beleza feminina', 'Pet', 'Leitura', 'Academia_Fitness', 'Mobile_Games']);
  if (validCategories.has(currentCategory)) {
    return currentCategory;
  }

  return 'Eletrônicos'; // Catch-all default seguro
}

/**
 * Classificador Offline rápido baseado em regras de palavras-chave.
 * @param {Array<object>} products 
 * @returns {Array<object>} Produtos classificados
 */
function fallbackClassify(products) {
  return products.map(p => {
    // Roda a sanitização a partir de um valor padrão "Outros"
    const cleanCat = sanitizeCategory(p, 'Outros');
    return {
      ...p,
      category: cleanCat,
      reason: 'Classificação por Regras Offline + Sanitizador Rígido'
    };
  });
}

/**
 * Classifica uma lista de produtos em lote utilizando a IA Gemini com fallback offline.
 * @param {Array<object>} products 
 * @returns {Promise<Array<object>>}
 */
async function batchClassifyProducts(products) {
  if (!products || products.length === 0) return [];

  // Se não houver chave API, cai pro fallback robusto
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'sua_chave_gemini_aqui') {
    console.warn('[Classificador] Sem API Key válida configurada. Usando classificador offline...');
    return fallbackClassify(products);
  }

  // Prepara a lista de títulos para enviar
  const titlesList = products.map((p, index) => `[${index}] ${p.name}`).join('\n');
  
  const prompt = `
Você é um categorizador de e-commerce preciso e semântico.
Classifique cada um dos produtos abaixo estritamente em uma das seguintes categorias exatas:
"Gamer", "Cozinha", "Eletrônicos", "Beleza feminina", "Pet", "Leitura", "Academia_Fitness", "Mobile_Games" ou "Outros".

Regras MUITO IMPORTANTES:
1. "Mobile_Games": APENAS smartphones/celulares (iPhone, Samsung Galaxy, Xiaomi Redmi, Motorola Moto, Poco), consoles de videogame (PS4, PS5, Xbox Series S/X, Nintendo Switch, Steam Deck) e controles de videogame. NADA MAIS. Capas, películas, cabos e carregadores de celular vão para "Eletrônicos".
2. "Gamer": Exclusivo para PC Gaming e Setup (teclado, mouse, headset, monitor, cadeira gamer, PC hardware/placas). NÃO coloque consoles ou jogos de videogame aqui.
3. "Eletrônicos": QUALQUER gadget ou acessório tecnológico. Inclui: fones de ouvido (Bluetooth ou fio), caixas de som, smartwatches, assistentes virtuais (Alexa), roteadores, câmeras, power banks, cabos, carregadores de celular, adaptadores, ring lights, drones, pendrives, além de eletrodomésticos grandes/linha branca e notebooks/tablets. NÃO coloque smartphones aqui.
4. "Cozinha": APENAS eletrodomésticos e utensílios domésticos de cozinha (air fryer, panela, liquidificador, cafeteira, batedeira, frigideira, faca de cozinha, pote, micro-ondas, grill). NUNCA coloque livros, suplementos, produtos de limpeza, maquiagem ou qualquer outra coisa aqui.
5. "Beleza feminina": Maquiagem, skincare, secador, chapinha, perfumes, cosméticos e produtos capilares.
6. "Pet": Rações, brinquedos, acessórios para animais, higiene pet.
7. "Leitura": Kindles, livros físicos, e-readers, mangás, box de livros. "Desenvolvimento pessoal", "Negócios", "Biografias" também são Leitura.
8. "Academia_Fitness": Suplementos esportivos (Whey, Creatina, BCAA), acessórios de treino, roupas esportivas, equipamentos fitness.
9. "Outros": Apenas itens totalmente fora de contexto (ferramentas pesadas, produtos de limpeza, fraldas de bebê, artigos de papelaria genéricos).

Se for ligado a tecnologia/informática de qualquer forma e não for PC Gamer nem Smartphone/Console, use "Eletrônicos". Se estiver muito incerto e não for tech, retorne "Outros".

Retorne APENAS um JSON válido no formato de array, onde a chave "index" é o número da linha, "category" é a categoria escolhida, e "reason" é uma frase super curta explicando o motivo da classificação. Exemplo:
[
  {"index": 0, "category": "Mobile_Games", "reason": "É um smartphone"},
  {"index": 1, "category": "Academia_Fitness", "reason": "Suplemento esportivo"}
]

Produtos a classificar:
${titlesList}
`;

  try {
    const ai = getGenAI();
    const model = ai.getGenerativeModel({ model: "gemini-flash-latest" });
    const result = await model.generateContent(prompt);
    let text = result.response.text();
    
    // Limpa crases markdown do JSON
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const classifications = JSON.parse(text);
    
    // Mapeia o resultado de volta para os produtos aplicando o sanitizador estrito
    const classifiedProducts = products.map((p, index) => {
      const match = classifications.find(c => parseInt(c.index) === index);
      const rawCategory = match ? match.category : 'Outros';
      
      // Camada higienizadora de segurança pós-IA
      const finalCategory = sanitizeCategory(p, rawCategory);
      let finalReason = match && match.reason ? match.reason : 'Classificado pela IA';

      if (rawCategory !== finalCategory) {
        finalReason = `Corrigido por sanitizador rígido (IA sugeriu: ${rawCategory})`;
        console.log(`[Classificador] ⚠️ IA sugeriu "${rawCategory}" para "${p.name.substring(0, 40)}...", corrigido para "${finalCategory}"`);
      }

      return {
        ...p,
        category: finalCategory,
        reason: finalReason
      };
    });
    
    return classifiedProducts;
  } catch (error) {
    console.error('[Classificador] Falha na IA em lote. Usando Classificador Offline. Erro:', error.message);
    return fallbackClassify(products);
  }
}

/**
 * Wrapper para classificar um único produto (fallback offline rápido).
 * @param {string} title 
 * @returns {object} { category, confidence, reason }
 */
function classifyProduct(title) {
  const results = fallbackClassify([{ name: title }]);
  const cat = results[0] ? results[0].category : 'Eletrônicos';
  return { 
    category: cat, 
    confidence: '100%', 
    reason: results[0] ? results[0].reason : 'Classificador offline por regras de palavras-chave' 
  };
}

module.exports = {
  batchClassifyProducts,
  classifyProduct,
  fallbackClassify,
  sanitizeCategory
};
