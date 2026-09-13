const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');

console.log('=== AUDITORIA COMPLETA DO SISTEMA ===\n');

// 1. Verificar links na fila pendente do WhatsApp
db.all("SELECT id, product_name, niche, message FROM whatsapp_queue WHERE status='pending'", (e, rows) => {
  console.log(`📋 FILA WHATSAPP PENDENTE: ${rows ? rows.length : 0} itens`);
  if (rows) {
    rows.forEach(r => {
      // Extrai o link do corpo da mensagem
      const linkMatch = r.message ? r.message.match(/https:\/\/www\.amazon\.com\.br\/[^\s]+/) : null;
      const link = linkMatch ? linkMatch[0] : 'SEM LINK';
      const isClean = link.includes('/dp/') && link.length < 80;
      const status = isClean ? '✅' : '❌ SUJO';
      console.log(`  ${status} [${r.niche}] ${r.product_name.substring(0, 40)} -> ${link.substring(0, 70)}`);
    });
  }

  // 2. Verificar links no histórico de enviados (últimos 20)
  db.all("SELECT name, affiliate_link, niche FROM sent_products ORDER BY id DESC LIMIT 20", (e2, r2) => {
    console.log(`\n📜 ÚLTIMOS 20 ENVIADOS:`);
    let dirtyCount = 0;
    if (r2) {
      r2.forEach(r => {
        const isClean = r.affiliate_link.includes('/dp/') && r.affiliate_link.length < 80;
        if (!isClean) dirtyCount++;
        const status = isClean ? '✅' : '❌';
        console.log(`  ${status} [${r.niche.padEnd(18)}] ${r.name.substring(0, 35).padEnd(37)} -> ${r.affiliate_link.substring(0, 65)}`);
      });
    }
    console.log(`\n  Links sujos no histórico recente: ${dirtyCount}`);

    // 3. Contar total de links sujos no banco inteiro
    db.all("SELECT COUNT(*) as c FROM sent_products WHERE affiliate_link NOT LIKE '%/dp/%'", (e3, r3) => {
      console.log(`  Links sujos NO TOTAL do banco: ${r3 ? r3[0].c : '?'}`);

      // 4. Verificar variedade: últimos 10 enviados por categoria
      db.all("SELECT niche, name FROM sent_products WHERE niche='Cozinha' ORDER BY id DESC LIMIT 10", (e4, r4) => {
        console.log(`\n🍳 ÚLTIMOS 10 COZINHA:`);
        if (r4) r4.forEach(r => console.log(`  - ${r.name.substring(0, 60)}`));

        db.all("SELECT niche, name FROM sent_products WHERE niche='Gamer' ORDER BY id DESC LIMIT 10", (e5, r5) => {
          console.log(`\n🎮 ÚLTIMOS 10 GAMER:`);
          if (r5) r5.forEach(r => console.log(`  - ${r.name.substring(0, 60)}`));

          db.all("SELECT niche, name FROM sent_products WHERE niche='Eletrônicos' ORDER BY id DESC LIMIT 10", (e6, r6) => {
            console.log(`\n📱 ÚLTIMOS 10 ELETRÔNICOS:`);
            if (r6) r6.forEach(r => console.log(`  - ${r.name.substring(0, 60)}`));
            db.close();
          });
        });
      });
    });
  });
});
