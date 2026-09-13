const db = require('./src/database/database');

async function check() {
  const groups = await db.getQuery('SELECT * FROM groups');
  console.log('Grupos configurados:', groups);
  process.exit(0);
}

check();
