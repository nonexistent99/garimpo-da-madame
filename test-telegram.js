require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token || token === 'seu_token_aqui') {
  console.log('Token inválido na .env');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: false });

async function test() {
  const chatId = '@garimpodigitalprimehub'; // do db-check
  try {
    console.log(`Tentando enviar mensagem para ${chatId}...`);
    await bot.sendMessage(chatId, 'Mensagem de teste do Offers Bot!');
    console.log('Mensagem enviada com sucesso!');
  } catch (err) {
    console.error('Falha ao enviar:', err.message);
    if (err.response && err.response.body) {
      console.error(err.response.body);
    }
  }
}
test();
