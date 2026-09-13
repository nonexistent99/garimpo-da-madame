const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
  const url = 'https://www.amazon.com.br/s?k=mouse+gamer';
  console.log('Fetching...');
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }
  });
  const $ = cheerio.load(response.data);
  const items = $('div[data-component-type="s-search-result"]');
  console.log(`Found ${items.length} items`);
  
  if (items.length > 0) {
    const el = items.first();
    console.log('HTML of first item:');
    console.log(el.html().substring(0, 1500));
    console.log('\n--- Extraction test ---');
    console.log('h2 text:', el.find('h2').text());
    console.log('h2 html:', el.find('h2').html());
    
    // Procura por todos os links do elemento
    el.find('a').each((i, a) => {
      console.log(`Link ${i}:`, $(a).attr('href'), '| class:', $(a).attr('class'));
    });
  }
}
test();
