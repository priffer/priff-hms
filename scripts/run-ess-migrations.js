// scripts/run-ess-migrations.js
// รัน migration 06/07/08 (ESS redesign: leave management, advance_payments RLS fix,
// announcements + holiday calendar) บน Staging DB ที่ผู้ใช้ยืนยันแล้วว่าเป็น Staging
// ใช้ .env DATABASE_URL เดียวกับ scripts/run-sql.js เดิม
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./lib/env.js');

async function run() {
  const { DATABASE_URL } = getConfig();
  if (!DATABASE_URL) {
    console.error('DATABASE_URL not set in .env');
    process.exit(2);
  }

  let sanitizedConn = DATABASE_URL;
  const m = DATABASE_URL.match(/^(.*?:\/\/)([^:\/\?#]+):([^@]+)@(.*)$/);
  if (m) sanitizedConn = m[1] + m[2] + ':' + encodeURIComponent(m[3]) + '@' + m[4];

  const client = new Client({ connectionString: sanitizedConn });
  await client.connect();

  const files = [
    path.resolve(__dirname, '..', 'database', '06_leave_management.sql'),
    path.resolve(__dirname, '..', 'database', '07_advance_payments_rls.sql'),
    path.resolve(__dirname, '..', 'database', '08_announcements_holidays.sql'),
  ];

  const results = [];
  try {
    for (const f of files) {
      console.log('\n----------\nRunning file:', path.basename(f));
      const sql = fs.readFileSync(f, 'utf8');
      try {
        await client.query(sql);
        console.log('SUCCESS:', path.basename(f));
        results.push({ file: path.basename(f), status: 'success' });
      } catch (err) {
        console.error('ERROR executing', path.basename(f), ':', err.message);
        try { await client.query('ROLLBACK;'); } catch (e) {}
        results.push({ file: path.basename(f), status: 'failed', error: err.message });
      }
    }
  } finally {
    await client.end();
  }

  console.log('\nRun summary:');
  console.log(JSON.stringify(results, null, 2));
}

run().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
