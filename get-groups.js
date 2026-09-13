const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');

db.all("SELECT * FROM groups", (err, rows) => {
  if (err) {
    console.error(err);
  } else {
    console.log("=== GRUPOS CONFIGURADOS ===");
    console.table(rows);
  }
  db.close();
});
