const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');
db.serialize(() => {
  db.run("DELETE FROM groups WHERE platform = 'whatsapp'");
  const categories = ['Gamer', 'Cozinha', 'Eletrônicos', 'Beleza feminina', 'Pet', 'Leitura', 'Academia_Fitness', 'Mobile_Games'];
  const stmt = db.prepare("INSERT INTO groups (niche, platform, target_id) VALUES (?, 'whatsapp', '120363426157432603@g.us')");
  categories.forEach(cat => stmt.run(cat));
  stmt.finalize();
  console.log('Grupos do WhatsApp atualizados no banco de dados!');
});
