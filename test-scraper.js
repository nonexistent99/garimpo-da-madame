const { runAutoScraper } = require('./src/services/autoScraper');
const { queues } = require('./src/jobs/offerJob');

async function test() {
  console.log('Testando AutoScraper...');
  await runAutoScraper();
  console.log('Fim do scraper. Estado das filas:');
  console.dir(queues, { depth: null });
  process.exit(0);
}

test();
