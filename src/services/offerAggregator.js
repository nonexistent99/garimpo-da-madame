const { runAutoScraper } = require('./sources/amazonSource');
const { runJsonSource } = require('./sources/jsonSource');
const { queues } = require('../jobs/offerJob');

async function runAggregator() {
  console.log('\n[Aggregator] Iniciando orquestração de fontes de ofertas...');
  
  let totalExtracted = 0;
  
  try {
    console.log('[Aggregator] Acionando Fonte Principal: Amazon...');
    const amazonResults = await runAutoScraper();
    totalExtracted += amazonResults || 0;
  } catch (err) {
    console.error('[Aggregator] Fonte Principal (Amazon) falhou criticamente:', err.message);
  }
  
  // Lógica de Fallback por Categoria: Se alguma gaveta RAM terminar vazia, 
  // acionamos as ofertas locais de emergência para aquele nicho específico
  const targetCategories = ['Gamer', 'Cozinha', 'Eletrônicos', 'Beleza feminina', 'Pet', 'Leitura', 'Academia_Fitness', 'Mobile_Games'];
  
  for (const cat of targetCategories) {
    if (!queues[cat] || queues[cat].length === 0) {
      console.log(`[Aggregator] ⚠️ Gaveta "${cat}" está vazia neste momento. Acionando emergência (JSON Local)...`);
      try {
        const fallbackCount = await runJsonSource(cat);
        totalExtracted += fallbackCount || 0;
      } catch (err) {
        console.error(`[Aggregator] Falha ao acionar fallback de emergência para ${cat}:`, err.message);
      }
    }
  }
  
  console.log(`[Aggregator] Orquestração finalizada! Saldo total da rodada: ${totalExtracted} produtos nas gavetas.\n`);
}

module.exports = { runAggregator };
