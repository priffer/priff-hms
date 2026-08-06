const { getConfig } = require('./lib/env.js');
const { Client } = require('pg');
(async () => {
  const { DATABASE_URL, SERVICE_KEY, PROJECT_URL } = getConfig();
  const m = DATABASE_URL.match(/^(.*?:\/\/)([^:\/\?#]+):([^@]+)@(.*)$/);
  const conn = m ? m[1] + m[2] + ':' + encodeURIComponent(m[3]) + '@' + m[4] : DATABASE_URL;
  const client = new Client({ connectionString: conn });
  await client.connect();

  const EMP_ID = 'DEMOADMIN';
  const PHONE = '0888888888';
  const EMAIL = 'demoadmin@kc-clean.internal';
  const COMPANY_ID = 'comp_kc_clean';

  try {
    let authUserId;
    const createRes = await fetch(`${PROJECT_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PHONE, email_confirm: true })
    });
    const created = await createRes.json();
    if (createRes.ok) {
      authUserId = created.id;
      console.log('Created new auth user:', authUserId);
    } else if (/already.*registered|already.*exists/i.test(created.msg || created.message || '')) {
      const listRes = await fetch(`${PROJECT_URL}/auth/v1/admin/users?per_page=200`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      }).then(r => r.json());
      authUserId = (listRes.users || []).find(u => u.email === EMAIL)?.id;
      console.log('Found existing auth user:', authUserId);
    } else {
      throw new Error('Auth create failed: ' + JSON.stringify(created));
    }

    const existingEmp = await client.query(`SELECT id FROM public.employees WHERE emp_id = $1 AND company_id = $2 LIMIT 1;`, [EMP_ID, COMPANY_ID]);
    let employeeId;
    if (existingEmp.rows.length > 0) {
      employeeId = existingEmp.rows[0].id;
    } else {
      const empRes = await client.query(`
        INSERT INTO public.employees (full_name, emp_id, email, phone_number, company_id, status)
        VALUES ('ผู้ดูแลระบบทดสอบสาธิต (Demo)', $1, $2, $3, $4, 'hired')
        RETURNING id;
      `, [EMP_ID, EMAIL, PHONE, COMPANY_ID]);
      employeeId = empRes.rows[0].id;
    }

    await client.query(`
      INSERT INTO public.user_profiles (auth_uid, employee_id, company_id, role, status, email, full_name, emp_id)
      VALUES ($1, $2, $3, 'admin', 'active', $4, 'ผู้ดูแลระบบทดสอบสาธิต (Demo)', $5)
      ON CONFLICT (auth_uid) DO UPDATE SET role = 'admin', status = 'active';
    `, [authUserId, employeeId, COMPANY_ID, EMAIL, EMP_ID]);

    console.log('\n✅ Demo admin account ready:', EMAIL, '/', PHONE);
  } finally {
    await client.end();
  }
})();
