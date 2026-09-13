const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
  try {
    const { data } = await axios.get('https://www.amazon.com.br/deals', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const $ = cheerio.load(data);
    console.log('Title:', $('title').text());
    console.log('Body length:', data.length);
    if (data.includes('captcha') || data.includes('robot')) {
      console.log('BLOCKED BY CAPTCHA');
    } else {
      console.log('SUCCESS');
    }
  } catch (err) {
    console.error('ERROR:', err.message);
  }
}
test();
