const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');

db.all("SELECT id, product_name, niche FROM whatsapp_queue WHERE status='pending' ORDER BY product_name", (err, rows) => {
  if (err) { console.error(err); return; }
  
  const seen = {};
  const toDel = [];
  
  rows.forEach(r => {
    // Pega as primeiras 5 palavras como chave de deduplicação
    const base = r.product_name.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).slice(0, 5).join(' ');
    const key = base + '|' + r.niche;
    if (seen[key]) {
      toDel.push(r.id);
      console.log(`DUPLICATA: [${r.niche}] ${r.product_name.substring(0, 60)}`);
    } else {
      seen[key] = r.id;
    }
  });
  
  console.log(`\nTotal de duplicatas encontradas: ${toDel.length}`);
  
  if (toDel.length > 0) {
    db.run(`UPDATE whatsapp_queue SET status='no_group' WHERE id IN (${toDel.join(',')})`, (e) => {
      if (e) console.error(e);
      else console.log('✅ Duplicatas removidas da fila!');
    });
  } else {
    console.log('Fila está limpa, sem duplicatas.');
  }
});
