const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

let sock = null;
let qrCodeDataUrl = null;
let qrCodeRaw = null;
let connectionStatus = 'disconnected'; // 'disconnected' | 'qr_ready' | 'connected'
let lastConnectedAt = null;
let lastDisconnectReason = null;
let reconnectAttempts = 0;
let manualReconnectScheduled = false;
const readyCallbacks = [];

// AUTH_FOLDER pode ser configurado via env. Default: ./.wwebjs_auth na raiz do projeto.
const AUTH_FOLDER = process.env.WA_AUTH_FOLDER || path.join(__dirname, '../../.wwebjs_auth');

// Garante que a pasta de auth existe ANTES de qualquer operação
function ensureAuthFolder() {
  try {
    if (!fs.existsSync(AUTH_FOLDER)) {
      fs.mkdirSync(AUTH_FOLDER, { recursive: true });
      console.log(`[WhatsApp] 📁 Pasta de credenciais criada: ${AUTH_FOLDER}`);
    }
  } catch (err) {
    console.error('[WhatsApp] ❌ Erro ao criar pasta de auth:', err.message);
  }
}

function hasSavedSession() {
  try {
    if (!fs.existsSync(AUTH_FOLDER)) return false;
    const files = fs.readdirSync(AUTH_FOLDER);
    // creds.json é o arquivo principal da sessão Baileys
    return files.some(f => f === 'creds.json' || f.startsWith('app-state'));
  } catch (e) {
    return false;
  }
}

function getSessionInfo() {
  try {
    ensureAuthFolder();
    const files = fs.existsSync(AUTH_FOLDER) ? fs.readdirSync(AUTH_FOLDER) : [];
    const credsPath = path.join(AUTH_FOLDER, 'creds.json');
    const hasCreds = files.includes('creds.json');
    let credsModified = null;
    if (hasCreds) {
      const stat = fs.statSync(credsPath);
      credsModified = stat.mtime.toISOString();
    }
    return {
      folder: AUTH_FOLDER,
      exists: fs.existsSync(AUTH_FOLDER),
      hasCreds,
      credsModified,
      totalFiles: files.length,
      status: connectionStatus,
      lastConnectedAt,
      lastDisconnectReason,
      reconnectAttempts,
    };
  } catch (err) {
    return { error: err.message };
  }
}

function onReady(callback) {
  if (typeof callback !== 'function') return;
  readyCallbacks.push(callback);
  if (connectionStatus === 'connected') {
    Promise.resolve().then(() => callback()).catch(err => console.error('[WhatsApp onReady] callback error:', err.message));
  }
}

function scheduleReconnect(delayMs) {
  if (manualReconnectScheduled) return;
  manualReconnectScheduled = true;
  reconnectAttempts++;
  console.log(`[WhatsApp] 🔁 Reagendando conexão em ${Math.round(delayMs / 1000)}s (tentativa #${reconnectAttempts})`);
  setTimeout(() => {
    manualReconnectScheduled = false;
    startWhatsApp().catch(err => console.error('[WhatsApp] Erro na reconexão:', err.message));
  }, delayMs);
}

function computeBackoffDelay() {
  // Exponential backoff: 3s, 6s, 12s, 24s, 48s, max 120s
  const delay = Math.min(3000 * Math.pow(2, Math.min(reconnectAttempts, 5)), 120000);
  return delay;
}

async function startWhatsApp() {
  ensureAuthFolder();

  const sessionExists = hasSavedSession();
  if (sessionExists) {
    console.log(`[WhatsApp] 🔐 Sessão salva encontrada em ${AUTH_FOLDER}. Reusando credenciais...`);
  } else {
    console.log(`[WhatsApp] 🆕 Nenhuma sessão salva em ${AUTH_FOLDER}. Vou gerar QR Code.`);
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth: state,
    printQRInTerminal: false,
    browser: ['OffersBot', 'Chrome', '3.0'],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    // markOnlineOnConnect: false  // não marca como online (evita celular dormir)
    markOnlineOnConnect: false,
    // Mantém os eventos de histórico vazios para reduzir RAM/CPU
    syncFullHistory: false,
  });

  // Sempre persiste credenciais
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      connectionStatus = 'qr_ready';
      qrCodeRaw = qr;
      console.log('\n[WhatsApp] 📱 Escaneie o QR Code abaixo com seu WhatsApp:');
      qrcodeTerminal.generate(qr, { small: true });
      qrCodeDataUrl = await qrcode.toDataURL(qr);
      console.log('[WhatsApp] QR Code disponível em: /api/whatsapp/qr\n');
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || 'desconhecido';
      lastDisconnectReason = `${statusCode || '—'} (${reason})`;
      connectionStatus = 'disconnected';

      // Classificação completa de motivos de desconexão (Baileys)
      switch (statusCode) {
        case DisconnectReason.loggedOut:
          console.log('[WhatsApp] 🚪 Sessão deslogada pelo celular (loggedOut). Apagando credenciais e gerando NOVO QR Code...');
          // SÓ aqui apagamos os credentials — apenas em logout explícito
          try {
            if (fs.existsSync(AUTH_FOLDER)) {
              fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
              console.log('[WhatsApp] 🗑️  Pasta .wwebjs_auth apagada.');
            }
          } catch (e) {
            console.error('[WhatsApp] Erro ao apagar pasta auth:', e.message);
          }
          reconnectAttempts = 0;
          scheduleReconnect(3000);
          break;

        case DisconnectReason.badSession:
          console.log('[WhatsApp] ⚠️  Sessão corrompida (badSession). Limpando e regenerando...');
          try { fs.rmSync(AUTH_FOLDER, { recursive: true, force: true }); } catch (e) {}
          reconnectAttempts = 0;
          scheduleReconnect(3000);
          break;

        case DisconnectReason.connectionClosed:
          console.log('[WhatsApp] 🔌 Conexão fechada pelo servidor. Tentando reconectar...');
          scheduleReconnect(computeBackoffDelay());
          break;

        case DisconnectReason.connectionLost:
          console.log('[WhatsApp] 📡 Conexão com servidor perdida (rede). Tentando reconectar...');
          scheduleReconnect(computeBackoffDelay());
          break;

        case DisconnectReason.connectionReplaced:
          console.log('[WhatsApp] ♻️  Conexão substituída (outra sessão abriu). Aguardando 30s antes de reconectar.');
          scheduleReconnect(30000);
          break;

        case DisconnectReason.restartRequired:
          console.log('[WhatsApp] 🔄 Reinício requerido pelo Baileys. Reconectando imediatamente...');
          scheduleReconnect(1000);
          break;

        case DisconnectReason.timedOut:
          console.log('[WhatsApp] ⏱️  Timeout de conexão. Reconectando...');
          scheduleReconnect(computeBackoffDelay());
          break;

        case DisconnectReason.multideviceMismatch:
          console.log('[WhatsApp] 📱 Conflito multi-dispositivo. Limpando sessão e regenerando...');
          try { fs.rmSync(AUTH_FOLDER, { recursive: true, force: true }); } catch (e) {}
          reconnectAttempts = 0;
          scheduleReconnect(3000);
          break;

        default:
          console.log(`[WhatsApp] ❓ Desconexão por motivo ${statusCode}: ${reason}. Reconectando...`);
          scheduleReconnect(computeBackoffDelay());
      }
    }

    if (connection === 'open') {
      connectionStatus = 'connected';
      qrCodeDataUrl = null;
      qrCodeRaw = null;
      lastConnectedAt = Date.now();
      reconnectAttempts = 0; // reset backoff
      lastDisconnectReason = null;
      console.log('[WhatsApp] ✅ Conectado com sucesso!');

      try { await listGroups(); } catch (e) {}

      for (const cb of readyCallbacks) {
        try { await cb(); } catch (err) { console.error('[WhatsApp onReady] callback error:', err.message); }
      }
    }
  });
}

async function listGroups() {
  try {
    if (!sock) return [];
    const groups = await sock.groupFetchAllParticipating();

    console.log('\n[WhatsApp] 📋 LISTA DE GRUPOS:');
    console.log('─'.repeat(60));
    const list = Object.values(groups).map(g => ({ id: g.id, name: g.subject }));
    list.forEach(g => {
      console.log(`Nome: ${g.name}`);
      console.log(`ID:   ${g.id}`);
      console.log('─'.repeat(60));
    });
    console.log('[WhatsApp] Total de grupos:', list.length, '\n');
    return list;
  } catch (err) {
    console.error('[WhatsApp] Erro ao listar grupos:', err.message);
    return [];
  }
}

async function sendWhatsAppMessage(groupId, text, imageUrl = null) {
  if (!sock || connectionStatus !== 'connected') {
    console.warn('[WhatsApp] ⚠️ Bot não está conectado. Mensagem ignorada.');
    return false;
  }

  try {
    const jid = groupId.includes('@g.us') ? groupId : `${groupId}@g.us`;

    if (imageUrl && !imageUrl.startsWith('data:image')) {
      await sock.sendMessage(jid, { image: { url: imageUrl }, caption: text });
    } else {
      await sock.sendMessage(jid, { text });
    }

    console.log(`[WhatsApp] ✅ Mensagem enviada para ${groupId}`);
    return true;
  } catch (err) {
    console.error(`[WhatsApp] ❌ Erro ao enviar para ${groupId}:`, err.message);
    return false;
  }
}

// Endpoint de "logout manual" — apenas se o usuário pedir explicitamente
async function clearSession() {
  try {
    if (sock) {
      try { await sock.logout(); } catch (e) {}
      sock = null;
    }
    if (fs.existsSync(AUTH_FOLDER)) {
      fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
    }
    connectionStatus = 'disconnected';
    qrCodeDataUrl = null;
    qrCodeRaw = null;
    lastConnectedAt = null;
    reconnectAttempts = 0;
    console.log('[WhatsApp] 🧹 Sessão limpa manualmente.');
    // Reinicia conexão (vai gerar novo QR)
    setTimeout(() => startWhatsApp().catch(e => console.error('Erro ao reiniciar:', e.message)), 1000);
    return true;
  } catch (err) {
    console.error('[WhatsApp] Erro ao limpar sessão:', err.message);
    return false;
  }
}

function getStatus() { return connectionStatus; }
function getQrCode() { return qrCodeDataUrl; }
function getQrCodeRaw() { return qrCodeRaw; }
function getLastConnectedAt() { return lastConnectedAt; }

module.exports = {
  startWhatsApp,
  sendWhatsAppMessage,
  listGroups,
  getStatus,
  getQrCode,
  getQrCodeRaw,
  getLastConnectedAt,
  onReady,
  getSessionInfo,
  clearSession,
};
