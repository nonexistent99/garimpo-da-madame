const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');

// 1. Pega todos os itens Gamer que foram marcados como 'sent' na fila
db.all("SELECT id, product_name, message FROM whatsapp_queue WHERE niche='Gamer' AND status='sent'", (e, rows) => {
  if (e) { console.error(e.message); return; }
  
  console.log(`Total de itens Gamer marcados como 'sent': ${rows.length}`);
  
  // Verifica quais têm links limpos (/dp/ASIN) e quais têm links sujos
  let cleanCount = 0;
  let dirtyCount = 0;
  rows.forEach(r => {
    if (r.message && r.message.includes('/dp/')) {
      cleanCount++;
    } else {
      dirtyCount++;
    }
  });
  
  console.log(`Com link limpo: ${cleanCount}`);
  console.log(`Com link sujo/quebrado: ${dirtyCount}`);
  
  // 2. Agora limpa a tabela sent_products de links sujos para permitir reenvio
  db.all("SELECT id, name, affiliate_link FROM sent_products WHERE niche='Gamer' AND affiliate_link NOT LIKE '%/dp/%'", (e2, dirty) => {
    if (e2) { console.error(e2.message); return; }
    console.log(`\nItens no histórico com link sujo: ${dirty.length}`);
    dirty.forEach(d => console.log(`  [${d.id}] ${d.name.substring(0, 40)} -> ${d.affiliate_link.substring(0, 50)}`));
    
    if (dirty.length > 0) {
      const ids = dirty.map(d => d.id).join(',');
      db.run(`DELETE FROM sent_products WHERE id IN (${ids})`, (e3) => {
        if (e3) console.error(e3.message);
        else console.log(`✅ ${dirty.length} itens com link sujo removidos do histórico Gamer.`);
        db.close();
      });
    } else {
      console.log('Nenhum link sujo para limpar no histórico.');
      db.close();
    }
  });
});
