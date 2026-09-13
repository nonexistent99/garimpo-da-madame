const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');

const AUTH_FOLDER = path.join(__dirname, '.wwebjs_auth');

const mapping = {
  'Gamer': '120363408801824800@g.us',
  'Cozinha': '120363427235389022@g.us',
  'Eletrônicos': '120363407495964635@g.us',
  'Beleza feminina': '120363427802091162@g.us',
  'Pet': '120363410226131492@g.us',
  'Leitura': '120363426209729628@g.us',
  'Academia_Fitness': '120363426157432603@g.us',
  'Mobile_Games': '120363427376215727@g.us'
};

async function testPing() {
  const { state } = await useMultiFileAuthState(AUTH_FOLDER);
  
  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    auth: state,
    printQRInTerminal: false,
    browser: ['OffersBot', 'Chrome', '3.0']
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection } = update;
    if (connection === 'open') {
      console.log('Conectado ao WhatsApp! Enviando pings de identificação para os 8 grupos...\n');
      
      for (const [niche, jid] of Object.entries(mapping)) {
        try {
          console.log(`Enviando ping para ${niche} (${jid})...`);
          await sock.sendMessage(jid, {
            text: `🚨 [PING DIAGNÓSTICO] Olá! Se você está lendo isso, este grupo está configurado no robô como o nicho: **${niche}**!\n\nPor favor, confirme se este grupo realmente deveria receber ofertas de **${niche}**.`
          });
          console.log(`✅ [SUCESSO] ${niche} enviado!`);
          await new Promise(r => setTimeout(r, 2000)); // Espera 2 segundos entre envios
        } catch (err) {
          console.error(`❌ [FALHA] ${niche} falhou: ${err.message}`);
        }
      }
      
      console.log('\nTodos os pings enviados! Encerrando...');
      process.exit(0);
    }
  });
}

testPing();
