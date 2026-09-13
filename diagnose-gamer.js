const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');

// Verifica as últimas mensagens Gamer
db.all("SELECT id, product_name, status, created_at FROM whatsapp_queue WHERE niche='Gamer' ORDER BY id DESC LIMIT 10", (e, rows) => {
  console.log('=== ÚLTIMAS 10 MENSAGENS GAMER NA FILA ===');
  if (e) console.error(e.message);
  else rows.forEach(r => console.log(`[${r.status}] ${r.created_at} | ${r.product_name.substring(0, 60)}`));

  // Verifica se há algum Gamer pendente
  db.all("SELECT COUNT(*) as c FROM whatsapp_queue WHERE niche='Gamer' AND status='pending'", (e2, r2) => {
    console.log('\nPendentes Gamer:', r2[0].c);
    
    // Verifica os sent_products do Gamer  
    db.all("SELECT name, affiliate_link FROM sent_products WHERE niche='Gamer' ORDER BY id DESC LIMIT 5", (e3, r3) => {
      console.log('\n=== ÚLTIMOS 5 ENVIADOS GAMER (histórico) ===');
      if (r3) r3.forEach(r => console.log(`${r.name.substring(0, 50)} -> ${r.affiliate_link.substring(0, 60)}`));

      // Verifica gaveta in-memory: quantas estão na fila gamer no offerJob
      // Vamos checar se a classificação Gamer está gerando produtos
      db.all("SELECT COUNT(*) as c FROM whatsapp_queue WHERE niche='Gamer'", (e4, r4) => {
        console.log('\nTotal Gamer na fila (todos status):', r4[0].c);
        db.close();
      });
    });
  });
});
