// scripts/verify-ess-migrations.js
// ตรวจสอบผลลัพธ์หลัง apply migration 06/07/08 - read-only sanity check
const { Client } = require('pg');
const { getConfig } = require('./lib/env.js');

async function run() {
  const { DATABASE_URL } = getConfig();
  const m = DATABASE_URL.match(/^(.*?:\/\/)([^:\/\?#]+):([^@]+)@(.*)$/);
  const conn = m ? m[1] + m[2] + ':' + encodeURIComponent(m[3]) + '@' + m[4] : DATABASE_URL;
  const client = new Client({ connectionString: conn });
  await client.connect();

  try {
    const tables = await client.query(`
      SELECT tablename, rowsecurity FROM pg_tables
      WHERE schemaname='public' AND tablename IN
      ('leave_types','leave_balances','leave_requests','announcements','company_holidays','client_holidays','advance_payments')
      ORDER BY tablename;
    `);
    console.log('Tables + RLS enabled:');
    console.table(tables.rows);

    const policies = await client.query(`
      SELECT tablename, policyname, cmd FROM pg_policies
      WHERE tablename IN ('leave_types','leave_balances','leave_requests','announcements','company_holidays','client_holidays','advance_payments')
      ORDER BY tablename, cmd;
    `);
    console.log('\nPolicies:');
    console.table(policies.rows);

    const holidays = await client.query(`SELECT holiday_date, name_th, holiday_type FROM public.company_holidays ORDER BY holiday_date;`);
    console.log('\nSeeded company_holidays:', holidays.rows.length, 'rows');
    console.table(holidays.rows);

    const leaveTypes = await client.query(`SELECT code, name_th, is_paid, max_days_per_year FROM public.leave_types ORDER BY code;`);
    console.log('\nSeeded leave_types:', leaveTypes.rows.length, 'rows');
    console.table(leaveTypes.rows);

    const cols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='advance_payments' AND column_name='employee_remark';`);
    console.log('\nadvance_payments.employee_remark column exists:', cols.rows.length > 0);
  } finally {
    await client.end();
  }
}

run().catch(err => { console.error('Fatal error:', err.message); process.exit(1); });
