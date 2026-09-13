const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');

const mapping = {
  'Gamer': '120363408801824800@g.us',
  'Cozinha': '120363427235389022@g.us',
  'Eletrônicos': '120363407495964635@g.us',
  'Beleza feminina': '120363427802091162@g.us',
  'Pet': '120363410226131492@g.us',
  'Leitura': '120363426209729628@g.us',
  'Academia_Fitness': '120363426157432603@g.us',
  'Mobile_Games': '120363427376215727@g.us'
};

db.serialize(() => {
  // Deleta os grupos atuais do whatsapp
  db.run("DELETE FROM groups WHERE platform = 'whatsapp'");

  // Insere os novos mapeamentos corretos
  const stmt = db.prepare("INSERT INTO groups (niche, platform, target_id) VALUES (?, 'whatsapp', ?)");
  for (const [niche, id] of Object.entries(mapping)) {
    stmt.run(niche, id);
  }
  stmt.finalize();

  console.log('Mapeamento dos 8 grupos de WhatsApp atualizado com sucesso no banco de dados!');
});
