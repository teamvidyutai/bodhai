// Quick DB setup script — run: node setup.js
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs    = require('fs');

async function setup() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    multipleStatements: true,
  });
  console.log('Connected to MySQL...');
  const schema = fs.readFileSync('./schema.sql', 'utf8');
  await conn.query(schema);
  console.log('Schema created!');
  await conn.end();
  console.log('\nSetup complete. Now run: npm start');
  console.log('Open: http://localhost:3000');
}
setup().catch(e => { console.error('Setup failed:', e.message); process.exit(1); });
