const db = require('./src/database/database');

async function debug() {
  const groups = await db.getQuery('SELECT * FROM groups');
  console.log('GRUPOS CADASTRADOS:', groups);
  
  const sent = await db.getQuery('SELECT * FROM sent_products ORDER BY id DESC LIMIT 10');
  console.log('ÚLTIMOS PRODUTOS ENVIADOS:', sent);
}
debug();
