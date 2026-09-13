const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
  try {
    const response = await axios.get('https://www.amazon.com.br/s?k=ofertas', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      }
    });
    
    const html = response.data;
    const $ = cheerio.load(html);
    
    const items = $('div[data-component-type="s-search-result"]');
    console.log(`Encontrados ${items.length} itens na página de busca via Axios.`);
    
    if (items.length > 0) {
      const firstItem = items.first();
      const title = firstItem.find('h2 span').text().trim();
      const link = firstItem.find('h2 a').attr('href');
      const price = firstItem.find('.a-price .a-offscreen').first().text().trim();
      const oldPrice = firstItem.find('.a-text-price .a-offscreen').first().text().trim();
      
      console.log('Primeiro item:');
      console.log('- Titulo:', title);
      console.log('- Link:', link);
      console.log('- Preco:', price);
      console.log('- Preco antigo:', oldPrice);
    }
  } catch (error) {
    console.error('Erro ao acessar a pagina:', error.message);
  }
}

test();
