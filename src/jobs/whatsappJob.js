const db = require('../database/database');
const { sendWhatsAppMessage, getStatus } = require('../services/whatsappService');
const { extractAsin } = require('../services/linkCleaner');

const DELAY_BETWEEN_MESSAGES_MS = 5000;
const MAX_PER_CYCLE = 10;

// Migração agora roda dentro do database.js. Só aguarda DB pronto.
let migrationExecuted = false;
async function initWhatsappQueueMigration() {
  if (migrationExecuted) return;
  try {
    await db.ready;
    migrationExecuted = true;
  } catch (err) {
    console.error('[WhatsApp Worker] Falha ao aguardar DB pronto:', err.message);
  }
}

// Mapa de nicho -> group_id do WhatsApp (buscado do banco)
async function getWhatsAppGroups() {
  try {
    const rows = await db.getQuery(
      "SELECT niche, target_id FROM groups WHERE platform = 'whatsapp'"
    );
    const map = {};
    rows.forEach(r => { map[r.niche] = r.target_id; });
    return map;
  } catch (err) {
    console.error('[WhatsApp Worker] Erro ao buscar grupos:', err.message);
    return {};
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Worker principal — chamado a cada 10 minutos pelo cron
async function runWhatsAppWorker() {
  await initWhatsappQueueMigration();

  if (getStatus() !== 'connected') {
    console.log('[WhatsApp Worker] ⏸️  Bot não conectado. Aguardando conexão...');
    return;
  }

  console.log('[WhatsApp Worker] 🚀 Iniciando ciclo de envios...');

  const groupMap = await getWhatsAppGroups();

  if (Object.keys(groupMap).length === 0) {
    console.log('[WhatsApp Worker] ⚠️  Nenhum grupo de WhatsApp cadastrado.');
    return;
  }

  try {
    // Busca pendentes que não excederam o limite de retries
    const pending = await db.getQuery(
      "SELECT * FROM whatsapp_queue WHERE status = 'pending' AND (retries IS NULL OR retries < 3) ORDER BY created_at ASC LIMIT ?",
      [MAX_PER_CYCLE]
    );

    if (pending.length === 0) {
      console.log('[WhatsApp Worker] 📭 Nenhuma mensagem pendente na fila.');
      return;
    }

    console.log(`[WhatsApp Worker] 📨 ${pending.length} mensagem(ns) na fila para envio.`);

    // Rastreia ASINs enviados NESTE ciclo para não repetir dentro do mesmo lote
    const asinsThisCycle = new Set();

    for (const item of pending) {
      const groupId = groupMap[item.niche];

      if (!groupId) {
        console.log(`[WhatsApp Worker] ⚠️  Sem grupo para "${item.niche}". Descartando.`);
        await db.runQuery("UPDATE whatsapp_queue SET status = 'no_group' WHERE id = ?", [item.id]);
        continue;
      }

      // Dedup por ASIN
      const asin = extractAsin(item.message);
      if (asin) {
        // Verifica se já mandou NESTE ciclo
        const cycleKey = `${asin}|${item.niche}`;
        if (asinsThisCycle.has(cycleKey)) {
          console.log(`[WhatsApp Worker] 🚫 ASIN ${asin} já enviado neste ciclo para ${item.niche}. Descartando.`);
          await db.runQuery("UPDATE whatsapp_queue SET status = 'duplicate' WHERE id = ?", [item.id]);
          continue;
        }

        // Verifica se já mandou NO HISTÓRICO DO WHATSAPP
        const history = await db.getQuery(
          "SELECT id FROM whatsapp_queue WHERE message LIKE ? AND niche = ? AND status = 'sent'",
          [`%${asin}%`, item.niche]
        );
        if (history.length > 0) {
          console.log(`[WhatsApp Worker] 🚫 ASIN ${asin} já enviado anteriormente no WhatsApp para ${item.niche}. Descartando.`);
          await db.runQuery("UPDATE whatsapp_queue SET status = 'duplicate' WHERE id = ?", [item.id]);
          continue;
        }
      }

      console.log(`[WhatsApp Worker] 📤 ${item.niche} -> ${item.product_name.substring(0, 55)}`);

      const sent = await sendWhatsAppMessage(groupId, item.message, item.image_url || null);

      if (sent) {
        await db.runQuery("UPDATE whatsapp_queue SET status = 'sent' WHERE id = ?", [item.id]);
        if (asin) asinsThisCycle.add(`${asin}|${item.niche}`);
        console.log(`[WhatsApp Worker] ✅ Enviado com sucesso.`);
      } else {
        const currentRetries = (item.retries || 0) + 1;
        if (currentRetries >= 3) {
          console.log(`[WhatsApp Worker] ❌ Falha persistente (Tentativa ${currentRetries}/3). Movendo para status 'failed'.`);
          await db.runQuery("UPDATE whatsapp_queue SET status = 'failed', retries = ? WHERE id = ?", [currentRetries, item.id]);
        } else {
          console.log(`[WhatsApp Worker] ❌ Falha ao enviar (Tentativa ${currentRetries}/3). Mantido na fila.`);
          await db.runQuery("UPDATE whatsapp_queue SET retries = ? WHERE id = ?", [currentRetries, item.id]);
        }
      }

      if (pending.indexOf(item) < pending.length - 1) {
        await sleep(DELAY_BETWEEN_MESSAGES_MS);
      }
    }

    console.log('[WhatsApp Worker] ✅ Ciclo finalizado.\n');
  } catch (err) {
    console.error('[WhatsApp Worker] ❌ Erro no ciclo:', err.message);
  }
}

module.exports = { runWhatsAppWorker };
