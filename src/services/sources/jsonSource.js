const fs = require('fs');
const path = require('path');
const { queueProduct } = require('../../jobs/offerJob');

async function runJsonSource(targetNiche = null) {
  console.log(`\n[JSON Source] Acionando Plano B (Fallback Local) ${targetNiche ? `para nicho ${targetNiche}` : ''}...`);
  
  const jsonPath = path.join(__dirname, '../../../fallback_offers.json');
  
  if (!fs.existsSync(jsonPath)) {
    console.log('[JSON Source] Arquivo fallback_offers.json não encontrado. Nenhuma oferta extraída.');
    return 0;
  }
  
  try {
    const data = fs.readFileSync(jsonPath, 'utf8');
    const offers = JSON.parse(data);
    
    let totalExtracted = 0;
    
    for (const offer of offers) {
      if (targetNiche && offer.niche !== targetNiche) continue;
      
      // Regra mínima de validação (independente da origem)
      if (!offer.name || !offer.currentPrice || !offer.affiliateLink) continue;
      
      const product = {
        name: offer.name,
        currentPrice: parseFloat(offer.currentPrice) || 0,
        oldPrice: parseFloat(offer.oldPrice) || parseFloat(offer.currentPrice),
        discount: parseInt(offer.discount) || 0,
        image: offer.image || '',
        affiliateLink: offer.affiliateLink,
        score: offer.score || 50 // Assume uma pontuação boa pois foi colocado à mão
      };
      
      const queued = queueProduct(product, offer.niche);
      if (queued) totalExtracted++;
    }
    
    console.log(`[JSON Source] Finalizado! ${totalExtracted} produtos emergenciais injetados com sucesso nas gavetas.\n`);
    return totalExtracted;
  } catch (err) {
    console.error('[JSON Source] Falha crítica ao ler o arquivo JSON:', err.message);
    return 0;
  }
}

module.exports = { runJsonSource };
