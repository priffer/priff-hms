// PHASE 13A step 4: Verify auth_uid mapping completeness (read-only).
const { Client } = require('pg');
const { getConfig } = require('./lib/env');
const { DATABASE_URL } = getConfig();

async function main() {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();
  try {
    const { rows } = await c.query(`
      SELECT up.id AS profile_id, up.role, up.emp_id, up.auth_uid, au.email AS auth_email
      FROM public.user_profiles up
      LEFT JOIN auth.users au ON au.id = up.auth_uid
      WHERE up.company_id = 'comp_kc_clean' AND up.role IN ('admin','payroll','supervisor','employee')
      ORDER BY up.role, up.id;
    `);
    console.log(JSON.stringify(rows, null, 2));

    const mappedCount = rows.filter(r => r.auth_email && r.auth_email.startsWith('qa-')).length;
    console.log('rows_mapped_to_qa_auth_users:', mappedCount, '/ expected 4 (one canonical per role)');
  } finally {
    await c.end();
  }
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
