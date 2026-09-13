require('dotenv').config();
const { generateMessage } = require('./src/services/messageGenerator');

(async () => {
  const product = {
    name: 'Teclado Gamer',
    currentPrice: 100,
    oldPrice: 200,
    discount: 50,
    affiliateLink: 'http://amazon'
  };
  try {
    const msg = await generateMessage(product, 'Gamer');
    console.log('Mensagem:', msg);
  } catch (err) {
    console.error('Erro:', err);
  }
})();
