const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;

function getGenAI() {
  if (!genAI && process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 10) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

/**
 * Fallback: texto genérico por nicho, sem inventar dados do produto.
 */
function generateSalesText(niche, productName) {
  const texts = {
    'Gamer': [
      'Eleve sua gameplay para o próximo nível com esse setup incrível!',
      'Mais FPS, mais vitórias! Se liga nessa oferta braba.',
      'Aquele upgrade que o seu PC tava pedindo, agora num precinho top!',
      'Os deuses do videogame abençoaram essa promoção. Aproveita!',
      'Seu setup de respeito começa aqui. Olha esse desconto!'
    ],
    'Beleza feminina': [
      'Aproveite essa oferta especial para realçar ainda mais a sua beleza.',
      'Seu momento de autocuidado ficou muito mais barato. Vem ver!',
      'Aquela make e skincare de milhões, por centavos!',
      'Glow up garantido com essa oferta imperdível.',
      'Sua rotina de beleza merece produtos incríveis, e seu bolso agradece!'
    ],
    'Cozinha': [
      'Praticidade e qualidade para a sua cozinha com um preço imperdível.',
      'Chefe de cozinha em casa! Facilite sua vida com essa promoção.',
      'Aquele utensílio que vai transformar suas receitas, num preço ótimo.',
      'Sua cozinha mais completa, moderna e prática.',
      'Renove os itens da sua casa com esse achadinho maravilhoso.'
    ],
    'Academia_Fitness': [
      'Foco nos resultados! Excelente oportunidade para dar um up no seu treino.',
      'Shape novo vindo aí! Se liga nessa promoção para o seu treino.',
      'Treinar pesado e pagar barato: a combinação perfeita!',
      'Sua saúde e performance no máximo nível, olha isso!',
      'Aquele empurrãozinho que faltava para a sua rotina fitness.'
    ],
    'Leitura': [
      'Sua próxima grande aventura literária com um desconto excelente.',
      'Mais livros na estante, menos dinheiro gasto. Aproveita!',
      'Aquele livro que você tava namorando finalmente entrou em promo!',
      'Viaje sem sair do lugar com essa leitura incrível.',
      'Uma história envolvente esperando por você. Corre que tá barato!'
    ],
    'Pet': [
      'Seu melhor amigo merece! Garanta agora com esse preço especial.',
      'Mimos para o seu pet com aquele desconto que a gente ama.',
      'Seu cãozinho ou gatinho vai amar essa surpresa.',
      'Conforto e alegria para o seu bichinho.',
      'Promoção boa é aquela que deixa o pet feliz e o bolso também!'
    ],
    'Eletrônicos': [
      'Tecnologia de ponta com um ótimo custo-benefício.',
      'Aquele gadget que você sempre quis, agora acessível!',
      'Modernize sua rotina com esse lançamento em oferta.',
      'A tecnologia a seu favor, num precinho que cabe no orçamento.',
      'Se liga nesse eletrônico brabo que achamos em promoção.'
    ],
    'Mobile_Games': [
      'O melhor do mundo mobile e dos games na palma da sua mão!',
      'Jogue em qualquer lugar com gráficos insanos. Olha esse preço!',
      'O upgrade perfeito para quem joga pelo celular ou portátil.',
      'Aquele acessório ou console que vai te garantir horas de diversão.',
      'Performance e bateria pra você nunca parar de jogar.'
    ],
    'Geral': [
      'Encontramos uma oferta fantástica para você aproveitar agora mesmo!',
      'Achadinho imperdível para você. Não deixa passar!',
      'Sério, olha o preço disso! Corre antes que acabe.',
      'Desconto exclusivo ativado! Aproveite.',
      'Uma daquelas ofertas que a gente só vê uma vez na vida.'
    ]
  };

  const options = texts[niche] || texts['Geral'];
  const randomIndex = Math.floor(Math.random() * options.length);
  return options[randomIndex];
}

/**
 * Gera texto de vendas personalizado via Gemini.
 * Tenta até 2x em caso de rate limit (429). Se falhar, usa fallback.
 */
async function getAiSalesText(productName, niche, discount) {
  const ai = getGenAI();
  if (!ai) {
    console.warn('[Gemini AI] API Key ausente — usando texto padrão.');
    return generateSalesText(niche, productName);
  }

  const discountLine = discount > 0
    ? `O produto está com ${discount}% de desconto real.`
    : 'Não mencione desconto numérico.';

  const prompt = `Você é um copywriter expert em grupos de ofertas do Telegram brasileiro.
Crie uma chamada de vendas ÚNICA e PERSONALIZADA de no máximo 2 frases curtas para este produto específico:
Produto: "${productName}"
Nicho do grupo: "${niche}"
${discountLine}

Regras IMPORTANTES:
- Mencione algo ESPECÍFICO do produto (ex: marca, capacidade, funcionalidade) — não escreva texto genérico
- Use linguagem informal e animada, como se fosse uma pessoa real
- Use 1 emoji relevante ao produto no máximo
- NÃO invente especificações que não estão no nome
- NÃO use frases como "Oferta encontrada" ou "Não perca"
- Retorne APENAS o texto da chamada, sem aspas, sem explicações`;

  try {
    const model = ai.getGenerativeModel({ model: 'gemini-flash-latest' });
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        let text = result.response.text().trim();
        text = text.replace(/^["'`]|["'`]$/g, '');
        if (!text || text.length < 10) {
          console.warn('[Gemini AI] Resposta vazia ou muito curta. Usando fallback.');
          return generateSalesText(niche, productName);
        }
        console.log(`[Gemini AI] ✅ Texto gerado para: ${productName.substring(0, 50)}...`);
        return text;
      } catch (retryErr) {
        if (retryErr.message && retryErr.message.includes('429') && attempt < 2) {
          console.warn('[Gemini AI] Rate limit atingido. Aguardando 5s antes de tentar novamente...');
          await new Promise(r => setTimeout(r, 5000));
        } else {
          throw retryErr;
        }
      }
    }
  } catch (error) {
    console.error('[Gemini AI] ❌ Erro ao gerar texto:', error.message, '— usando fallback.');
    return generateSalesText(niche, productName);
  }
}

/**
 * Monta a mensagem final formatada para Telegram/WhatsApp.
 */
async function generateMessage(product, niche) {
  const salesText = await getAiSalesText(product.name, niche, product.discount || 0);

  // Formatação correta BRL: 3980 -> "3.980,00"
  function formatBRL(val) {
    const n = parseFloat(val);
    if (isNaN(n) || n <= 0) return '?';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const oldPriceStr = formatBRL(product.oldPrice);
  const currentPriceStr = formatBRL(product.currentPrice);

  let priceSection = '';
  if (product.oldPrice > product.currentPrice) {
    priceSection = `💰 De: ~R$ ${oldPriceStr}~\n✅ Por: R$ ${currentPriceStr}`;
  } else {
    priceSection = `✅ Preço: R$ ${currentPriceStr}`;
  }

  const discountInfo = product.discount ? `\n📉 Desconto: ${product.discount}%` : '';

  return `🔥 Oferta encontrada!\n\n` +
         `${salesText}\n\n` +
         `📦 Produto: ${product.name}\n` +
         `${priceSection}` +
         `${discountInfo}\n\n` +
         `🛒 Comprar aqui:\n` +
         `${product.affiliateLink}\n\n` +
         `⚠️ Preço e disponibilidade podem mudar a qualquer momento.`;
}

module.exports = {
  generateMessage
};
