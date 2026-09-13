const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');

// 1. Limpa links sujos antigos (sem /dp/)
db.run("DELETE FROM sent_products WHERE affiliate_link NOT LIKE '%/dp/%'", function(e) {
  console.log(`✅ ${this.changes} links sujos removidos do histórico.`);

  // 2. Remove duplicatas do histórico
  db.run(`DELETE FROM sent_products WHERE id NOT IN (
    SELECT MIN(id) FROM sent_products GROUP BY affiliate_link, niche
  )`, function(e2) {
    console.log(`✅ ${this.changes} duplicatas de link removidas do histórico.`);
    
    // 3. Remove duplicatas por nome base na fila pendente
    db.run(`UPDATE whatsapp_queue SET status='no_group' WHERE id NOT IN (
      SELECT MIN(id) FROM whatsapp_queue WHERE status='pending' GROUP BY product_name, niche
    ) AND status='pending'`, function(e3) {
      console.log(`✅ ${this.changes} duplicatas removidas da fila WhatsApp.`);
      db.close();
    });
  });
});
