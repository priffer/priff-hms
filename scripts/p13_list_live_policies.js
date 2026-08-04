// PHASE 13A diagnostic: list ALL currently active RLS policies on employees & attendance_logs
// directly from pg_policies, to check for duplicate/stale/overly-permissive leftover policies
// (Postgres RLS policies are OR-combined when multiple permissive policies exist for the same command).
const { Client } = require('pg');
const { getConfig } = require('./lib/env');
const { DATABASE_URL } = getConfig();

async function main() {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();
  try {
    const { rows } = await c.query(`
      SELECT schemaname, tablename, policyname, cmd, qual, with_check
      FROM pg_policies
      WHERE tablename IN ('employees','attendance_logs','user_profiles','supervisor_client_assignments')
      ORDER BY tablename, policyname;
    `);
    for (const r of rows) {
      console.log(`\n=== ${r.tablename} :: ${r.policyname} (${r.cmd}) ===`);
      console.log('USING:', r.qual);
      console.log('WITH CHECK:', r.with_check);
    }
    console.log('\nTOTAL POLICIES FOUND:', rows.length);
  } finally {
    await c.end();
  }
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
