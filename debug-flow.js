const { runAggregator } = require('./src/services/offerAggregator');
const { queues } = require('./src/jobs/offerJob');
require('dotenv').config();

(async () => {
  console.log('Iniciando Teste Completo do Agregador...');
  await runAggregator();
  console.log('\n=== ESTADO DAS GAVETAS ===');
  console.log('Gamer:', queues['Gamer'].length);
  console.log('Cozinha:', queues['Cozinha'].length);
  console.log('Eletrônicos:', queues['Eletrônicos'].length);
  console.log('Beleza feminina:', queues['Beleza feminina'].length);
  console.log('Todos:', queues['Todos'].length);
  process.exit(0);
})();
