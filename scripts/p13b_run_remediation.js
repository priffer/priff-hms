// PHASE 13B: Execute database/05_rls_remediation.sql against UAT DATABASE_URL
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { getConfig } = require('./lib/env');
const { DATABASE_URL } = getConfig();

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', '05_rls_remediation.sql'), 'utf8');
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();
  try {
    await c.query(sql);
    console.log('OK: 05_rls_remediation.sql executed successfully.');
  } catch (e) {
    console.error('ERR', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}
main();
