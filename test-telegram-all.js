require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token || token === 'seu_token_aqui') {
  console.log('Token inválido na .env');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: false });

const channels = {
  'Cozinha': '@garimpodigitalprimehub',
  'Beleza feminina': '@ofertasvaultbrasil247',
  'Eletrônicos': '@primeachadosxbrasil',
  'Gamer': '@descontosecretoshubbr',
  'Pet': '@garimpoeliteoficialbr',
  'Leitura': '@ofertasquanticasprime',
  'Academia_Fitness': '@achadosblackvaultbr',
  'Mobile_Games': '@primeimpulsodealsbr'
};

async function testAll() {
  console.log('=== TESTANDO TODOS OS CANAIS DO TELEGRAM ===\n');
  for (const [niche, channel] of Object.entries(channels)) {
    try {
      console.log(`Tentando enviar mensagem para ${niche} (${channel})...`);
      await bot.sendMessage(channel, `Mensagem de teste de diagnóstico de canal para ${niche}!`);
      console.log(`✅ [SUCESSO] ${niche} enviado!`);
    } catch (err) {
      console.error(`❌ [FALHA] ${niche} (${channel}) falhou: ${err.message}`);
    }
  }
}

testAll();
