const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');

console.log('=== DIAGNÓSTICO DO BANCO DE DADOS ===\n');

db.all("SELECT * FROM groups", (err, groups) => {
  if (err) {
    console.error(err);
    return;
  }
  console.log("--- CONFIGURAÇÃO DE GRUPOS ---");
  console.table(groups);

  db.all("SELECT niche, status, COUNT(*) as count FROM whatsapp_queue GROUP BY niche, status", (err, wq) => {
    if (err) console.error(err);
    console.log("\n--- STATUS DA FILA DO WHATSAPP (whatsapp_queue) ---");
    console.table(wq);

    db.all("SELECT niche, COUNT(*) as count FROM sent_products GROUP BY niche", (err, sp) => {
      if (err) console.error(err);
      console.log("\n--- HISTÓRICO DE ENVIADOS (sent_products) ---");
      console.table(sp);

      // Verificando os últimos logs/erros ou mensagens de status falho/pendente
      db.all("SELECT id, product_name, status, retries, created_at FROM whatsapp_queue WHERE status = 'failed' OR status = 'pending' ORDER BY id DESC LIMIT 10", (err, failedOrPending) => {
        if (err) console.error(err);
        console.log("\n--- MENSAGENS PENDENTES OU FALHAS NA FILA DO WHATSAPP ---");
        console.table(failedOrPending);

        db.close();
      });
    });
  });
});
