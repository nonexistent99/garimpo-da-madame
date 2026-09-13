const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');

const AUTH_FOLDER = path.join(__dirname, '.wwebjs_auth');

async function findGroup() {
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
      console.log('Conectado. Buscando grupos...');
      const groups = await sock.groupFetchAllParticipating();
      const achadinhosGroups = Object.values(groups).filter(g => g.subject.toLowerCase().includes('achadinhos da amazon'));
      
      if (achadinhosGroups.length > 0) {
        console.log('\n--- GRUPOS "ACHADINHOS DA AMAZON" ENCONTRADOS ---');
        achadinhosGroups.forEach(g => {
          console.log(`Nome: ${g.subject}`);
          console.log(`ID: ${g.id}`);
          console.log('----------------------------------');
        });
      } else {
        console.log('\nNenhum grupo com a palavra "achadinhos da amazon" foi encontrado.');
      }
      process.exit(0);
    }
  });
}

findGroup();
