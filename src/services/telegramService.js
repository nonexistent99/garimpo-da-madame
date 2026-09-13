const TelegramBot = require('node-telegram-bot-api');
const db = require('../database/database');

const token = process.env.TELEGRAM_BOT_TOKEN;
let bot = null;

if (token && token !== 'seu_token_aqui') {
  bot = new TelegramBot(token, { 
    polling: false,
    request: {
      timeout: 10000 // 10 segundos de limite para evitar travamentos de rede
    }
  });
} else {
  console.warn('TELEGRAM_BOT_TOKEN não configurado. O envio para o Telegram não funcionará.');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Envia uma mensagem (com imagem opcional) para os canais cadastrados daquele nicho no Telegram.
 * Implementa retry automático com backoff exponencial.
 * @param {string} message Texto da mensagem
 * @param {string} image URL da imagem
 * @param {string} niche Categoria da oferta
 * @returns {Promise<boolean>} True se foi enviado com sucesso para pelo menos um grupo
 */
async function sendToTelegram(message, image, niche) {
  if (!bot) {
    console.log(`[Telegram - Simulação] Nicho: ${niche}\nMensagem:\n${message}`);
    return false;
  }

  try {
    // Buscar o target_id do grupo/canal para este nicho
    const groups = await db.getQuery(
      'SELECT target_id FROM groups WHERE niche = ? AND platform = ?', 
      [niche, 'telegram']
    );
    
    if (groups.length === 0) {
      console.log(`Nenhum grupo do Telegram configurado para o nicho: ${niche}`);
      return false;
    }

    let overallSuccess = false;

    for (const group of groups) {
      const chatId = group.target_id;
      let success = false;
      const retries = 3;

      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          if (image) {
            await bot.sendPhoto(chatId, image, { caption: message });
          } else {
            await bot.sendMessage(chatId, message);
          }
          console.log(`[Telegram] ✅ Oferta enviada com sucesso (Nicho: ${niche}, ChatID: ${chatId})`);
          success = true;
          overallSuccess = true;
          break; // Sai do loop de retries
        } catch (err) {
          const delay = 1000 * attempt;
          console.warn(`[Telegram] ⚠️  Falha ao enviar para ${chatId} (Tentativa ${attempt}/${retries}). Erro: ${err.message}`);
          if (attempt < retries) {
            await sleep(delay);
          }
        }
      }

      if (!success) {
        console.error(`[Telegram] ❌ Falha permanente ao enviar para o canal ${chatId} do nicho ${niche} após ${retries} tentativas.`);
      }
    }
    
    return overallSuccess;
  } catch (error) {
    console.error('[Telegram] Erro crítico ao processar despacho no banco de dados:', error.message);
    return false;
  }
}

module.exports = {
  sendToTelegram
};
