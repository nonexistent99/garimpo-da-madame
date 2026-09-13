const db = require('../database/database');

async function addToWhatsAppQueue(productName, message, niche, imageUrl) {
  try {
    console.log(`[WhatsApp Queue] Recebido imageUrl: ${imageUrl} para ${productName}`);
    await db.runQuery(
      'INSERT INTO whatsapp_queue (product_name, message, niche, image_url, status) VALUES (?, ?, ?, ?, ?)',
      [productName, message, niche, imageUrl, 'pending']
    );
    console.log(`Oferta adicionada à fila do WhatsApp (Produto: ${productName}, Nicho: ${niche})`);
    return true;
  } catch (error) {
    console.error('Erro ao adicionar à fila do WhatsApp:', error.message);
    return false;
  }
}

async function getPendingWhatsAppMessages() {
  try {
    return await db.getQuery("SELECT * FROM whatsapp_queue WHERE status = 'pending' ORDER BY created_at ASC");
  } catch (error) {
    console.error('Erro ao buscar mensagens do WhatsApp:', error.message);
    return [];
  }
}

async function markWhatsAppMessageAsSent(id) {
  try {
    await db.runQuery("UPDATE whatsapp_queue SET status = 'sent' WHERE id = ?", [id]);
    return true;
  } catch (error) {
    console.error(`Erro ao marcar mensagem ${id} do WhatsApp como enviada:`, error.message);
    return false;
  }
}

module.exports = {
  addToWhatsAppQueue,
  getPendingWhatsAppMessages,
  markWhatsAppMessageAsSent
};
