const { dispatchNextRound, queues, queueProduct } = require('./src/jobs/offerJob');

(async () => {
  console.log('Testando Dispatcher manualmente...');
  
  // Forçar produtos na gaveta
  queueProduct({
    name: 'Produto Teste Gamer',
    currentPrice: 100,
    oldPrice: 200,
    discount: 50,
    image: 'http://exemplo.com/img.jpg',
    affiliateLink: 'http://amazon.com.br/teste1',
    score: 100
  }, 'Gamer');
  
  console.log('Gaveta Gamer:', queues['Gamer'].length);
  
  try {
    await dispatchNextRound();
  } catch (err) {
    console.error('Erro no dispatcher:', err);
  }
  
  process.exit(0);
})();
