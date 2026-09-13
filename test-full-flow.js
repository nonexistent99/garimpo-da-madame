/**
 * Suíte de Testes Simulados E2E de Auditoria e Estabilização do Bot
 * Arquivo: test-full-flow.js
 */

const { parsePrice, validatePriceData } = require('./src/services/priceValidator');
const { extractAsin, buildCleanAffiliateLink } = require('./src/services/linkCleaner');
const { sanitizeCategory, classifyProduct } = require('./src/services/categoryClassifier');
const { normalizeProductIdentity } = require('./src/jobs/offerJob');

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║ 🧪 INICIANDO SUÍTE DE TESTES SIMULADOS DE ESTABILIDADE DO BOT║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

let failedTests = 0;
let passedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failedTests++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. TESTE DE VALIDAÇÃO DE PREÇOS
// ─────────────────────────────────────────────────────────────────────────────
console.log('🔹 [Fase 1] Testes do priceValidator.js...');

// parsePrice
assert(parsePrice('R$ 3.980,00') === 3980.00, 'parsePrice convert BRL milhar e vírgula corretamente');
assert(parsePrice('R$ 39,90') === 39.90, 'parsePrice convert BRL simples corretamente');
assert(parsePrice(129.99) === 129.99, 'parsePrice suporta números brutos');
assert(parsePrice(null) === 0, 'parsePrice trata null retornando 0');

// validatePriceData
const prodValido = {
  name: 'Fone JBL',
  currentPrice: 'R$ 150,00',
  oldPrice: 'R$ 200,00',
  coupon: '',
  badge: 'Promoção'
};
const resValido = validatePriceData(prodValido);
assert(resValido.valid === true && resValido.cleanProduct.discount === 25, 'validatePriceData aprova produto com desconto real e calcula 25%');

const prodZerado = {
  name: 'Fone JBL de graça',
  currentPrice: 'R$ 0,00',
  oldPrice: 'R$ 200,00'
};
const resZerado = validatePriceData(prodZerado);
assert(resZerado.valid === false && resZerado.reason.includes('Preço atual inválido'), 'validatePriceData descarta produto com preço atual zerado');

const prodInvertido = {
  name: 'Fone JBL inflacionado',
  currentPrice: 'R$ 250,00',
  oldPrice: 'R$ 200,00'
};
const resInvertido = validatePriceData(prodInvertido);
assert(resInvertido.valid === false && resInvertido.reason.includes('MENOR'), 'validatePriceData descarta produto com preço antigo menor que preço atual');

const prodSemDesconto = {
  name: 'Fone JBL preço cheio',
  currentPrice: 'R$ 200,00',
  oldPrice: 'R$ 200,00'
};
const resSemDesconto = validatePriceData(prodSemDesconto);
assert(resSemDesconto.valid === false && resSemDesconto.reason.includes('preço cheio'), 'validatePriceData descarta produto sem desconto, cupom ou selo');

console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// 2. TESTE DE LIMPEZA E FORMATAÇÃO DE LINKS
// ─────────────────────────────────────────────────────────────────────────────
console.log('🔹 [Fase 2] Testes do linkCleaner.js...');

const rawAmazonUrl = 'https://www.amazon.com.br/Notebook-Acer-Predator-Helios-PH16-71-7649/dp/B0CX23Q2XY/ref=sr_1_3?crid=261U&keywords=notebook+gamer&qid=171123&sprefix=notebook+gam%2Caps%2C222&sr=8-3&ufe=app_do_anuncio';
const cleanUrl = buildCleanAffiliateLink(rawAmazonUrl);
assert(cleanUrl === 'https://www.amazon.com.br/dp/B0CX23Q2XY?tag=hiurykng-20', 'buildCleanAffiliateLink reconstrói links da Amazon perfeitamente no formato curto e com tag');

const shortUrl = 'https://www.amazon.com.br/gp/product/B07P882X3R';
assert(buildCleanAffiliateLink(shortUrl) === 'https://www.amazon.com.br/dp/B07P882X3R?tag=hiurykng-20', 'buildCleanAffiliateLink extrai e higieniza ASIN a partir de gp/product');

console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// 3. TESTE DE CLASSIFICAÇÃO E SANITIZADOR RÍGIDO
// ─────────────────────────────────────────────────────────────────────────────
console.log('🔹 [Fase 3] Testes de Sanitização de Categorias (categoryClassifier.js)...');

const mockPs5 = { name: 'Console PlayStation 5 Slim 1TB + 2 Jogos', keywordSource: 'ps5' };
assert(sanitizeCategory(mockPs5, 'Gamer') === 'Mobile_Games', 'Sanitizador força Console PS5 para "Mobile_Games" mesmo que IA sugira "Gamer"');

const mockRacao = { name: 'Ração Golden Special Cães Adultos Frango 15kg', keywordSource: 'Cozinha' };
assert(sanitizeCategory(mockRacao, 'Cozinha') === 'Pet', 'Sanitizador força Ração para "Pet" mesmo que IA sugira "Cozinha"');

const mockLivro = { name: 'Livro - Pai Rico, Pai Pobre - Edição Comemorativa', keywordSource: 'Cozinha' };
assert(sanitizeCategory(mockLivro, 'Cozinha') === 'Leitura', 'Sanitizador força Livro de negócios para "Leitura" mesmo que IA sugira "Cozinha"');

const mockWhey = { name: '100% Whey Protein Concentrado Growth Supplements 1kg', keywordSource: 'academia' };
assert(sanitizeCategory(mockWhey, 'Eletrônicos') === 'Academia_Fitness', 'Sanitizador força Whey para "Academia_Fitness"');

const mockSecador = { name: 'Secador de Cabelo Taiff Unique 2600W Bivolt', keywordSource: 'secador' };
assert(sanitizeCategory(mockSecador, 'Cozinha') === 'Beleza feminina', 'Sanitizador força Secador de cabelo para "Beleza feminina"');

const mockPanela = { name: 'Jogo de Panelas Tramontina Turim 7 Peças Vermelho', keywordSource: 'panela' };
assert(sanitizeCategory(mockPanela, 'Gamer') === 'Cozinha', 'Sanitizador força Jogo de panelas para "Cozinha"');

const mockHeadset = { name: 'Headset Gamer HyperX Cloud Stinger Core PC/PS4', keywordSource: 'headset' };
assert(sanitizeCategory(mockHeadset, 'Eletrônicos') === 'Gamer', 'Sanitizador força Headset Gamer para "Gamer"');

const mockFoneBluetooth = { name: 'Fone de Ouvido Bluetooth JBL Wave Flex Sem Fio', keywordSource: 'fone bluetooth' };
assert(sanitizeCategory(mockFoneBluetooth, 'Gamer') === 'Eletrônicos', 'Sanitizador força Fone bluetooth comum para "Eletrônicos"');

const mockTvHq = { name: 'Smart TV HQ 24" HD tela sem bordas Android 12', keywordSource: 'tv hq' };
assert(sanitizeCategory(mockTvHq, 'Leitura') === 'Eletrônicos', 'Sanitizador força Smart TV HQ para "Eletrônicos" (evitando conflito com HQ de literatura)');

const mockSmartband = { name: 'Smartband HUAWEI Band 8 Design Ultra fino 14 dias de bateria', keywordSource: 'academia' };
assert(sanitizeCategory(mockSmartband, 'Academia_Fitness') === 'Eletrônicos', 'Sanitizador força Smartband para "Eletrônicos" (evitando conflito com Academia_Fitness)');

const mockMicroondas = { name: 'MONDIAL Micro-Ondas Branco 1200W', keywordSource: 'Cozinha' };
assert(sanitizeCategory(mockMicroondas, 'Cozinha') === 'Eletrônicos', 'Sanitizador força Micro-Ondas para "Eletrônicos" (eletrodoméstico de linha branca em vez de Cozinha)');

const mockPulseiraRedmi = { name: 'Pulseira Silicone Borracha Para Xiaomi Redmi Watch 3 ACTIVE', keywordSource: 'xiaomi redmi' };
assert(sanitizeCategory(mockPulseiraRedmi, 'Mobile_Games') === 'Eletrônicos', 'Sanitizador força Pulseira Redmi Watch para "Eletrônicos" (evitando conflito com Mobile_Games)');

const mockPuloGato = { name: 'Soft skills para a vida: o pulo do gato para desenvolver habilidades', keywordSource: 'desenvolvimento pessoal' };
assert(sanitizeCategory(mockPuloGato, 'Pet') === 'Leitura', 'Sanitizador força livro "pulo do gato" para "Leitura" (evitando conflito com gato de Pet)');

const mockProdutividade = { name: 'Produtividade redimida', keywordSource: 'produtividade' };
assert(sanitizeCategory(mockProdutividade, 'Eletrônicos') === 'Leitura', 'Sanitizador força livro de produtividade para "Leitura" (usando a inteligência de busca)');

console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// 4. TESTE DE DEDUPLICAÇÃO ABSOLUTA E HASH DE TÍTULOS
// ─────────────────────────────────────────────────────────────────────────────
console.log('🔹 [Fase 4] Testes de Variantes de Produto (Deduplicação de Título)...');

// Torradeira Arno variantes de cores e especificações
const torradeira1 = normalizeProductIdentity('Torradeira Arno Soleil Marfim 110v', 'https://amazon.com.br/dp/B07P882X3R');
const torradeira2 = normalizeProductIdentity('Torradeira Arno Soleil Preta Bivolt 220v', 'https://amazon.com.br/dp/B07P882X3R');
const torradeira3 = normalizeProductIdentity('Torradeira Arno Soleil Marfim 220v', 'https://amazon.com.br/dp/B07P882X4X'); // Link diferente!

assert(torradeira1.asin === 'B07P882X3R', 'Extração de ASIN 1 funciona perfeitamente');
assert(torradeira1.titleHash === torradeira2.titleHash, `Variante de cor/voltagem da torradeira Arno colapsa no mesmo titleHash: ${torradeira1.titleHash}`);
assert(torradeira1.titleHash === torradeira3.titleHash, `Variante de link diferente mas mesmo título colapsa no mesmo titleHash: ${torradeira1.titleHash}`);
assert(torradeira1.titleHash === 'arno_soleil_torradeira', `Title hash gerado confere: ${torradeira1.titleHash}`);

console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// RELATÓRIO FINAL DA SUÍTE DE TESTES
// ─────────────────────────────────────────────────────────────────────────────
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║               🏁 RELATÓRIO FINAL DOS TESTES                  ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`  📊 Aprovados:  ${passedTests}`);
console.log(`  📊 Reprovados: ${failedTests}`);
console.log('────────────────────────────────────────────────────────────────');

if (failedTests === 0) {
  console.log('  🎉 EXCELENTE! Todas as garantias de estabilidade foram validadas com 100% de sucesso!');
  process.exit(0);
} else {
  console.error('  ⚠️ ATENÇÃO! Alguns testes falharam. Verifique os módulos modificados.');
  process.exit(1);
}
