const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');
db.run("UPDATE whatsapp_queue SET status = 'sent' WHERE status = 'pending'", (err) => {
  if (err) console.error(err);
  else console.log('Fila antiga limpa!');
});
