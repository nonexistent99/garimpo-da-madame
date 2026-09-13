const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');

db.all("SELECT niche, target_id FROM groups WHERE platform='whatsapp'", (e, rows) => {
  console.log('=== GRUPOS WHATSAPP ===');
  if (e) { console.error(e.message); }
  else { rows.forEach(r => console.log(r.niche.padEnd(22), '->', r.target_id)); }

  db.all("SELECT niche, status, COUNT(*) as c FROM whatsapp_queue GROUP BY niche, status ORDER BY niche", (e2, r2) => {
    console.log('\n=== FILA WHATSAPP ===');
    if (e2) { console.error(e2.message); }
    else { r2.forEach(r => console.log(r.niche.padEnd(22), r.status.padEnd(12), r.c)); }

    db.all("SELECT niche, COUNT(*) as c FROM sent_products GROUP BY niche ORDER BY niche", (e3, r3) => {
      console.log('\n=== HISTORICO ENVIADOS ===');
      if (e3) { console.error(e3.message); }
      else { r3.forEach(r => console.log(r.niche.padEnd(22), r.c, 'enviados')); }
      db.close();
    });
  });
});
