// scripts/setup-demo-supervisor.js
// สร้างบัญชีสาธิตหัวหน้างาน (DEMOSUP) + ผูกดูแลไซต์ "Site A" (ไซต์เดียวกับ DEMO001)
// สำหรับทดสอบ flow อนุมัติคำขอแก้ไขเวลา/โอที ที่ resolve ไปหาหัวหน้างานไซต์นั้น
// เป็นข้อมูลใหม่ทั้งหมด ไม่แตะ/ลบข้อมูลเดิม (additive only, สำหรับ demo เท่านั้น)
const { Client } = require('pg');
const { getConfig } = require('./lib/env.js');

async function run() {
  const { DATABASE_URL, SERVICE_KEY, PROJECT_URL } = getConfig();
  const m = DATABASE_URL.match(/^(.*?:\/\/)([^:\/\?#]+):([^@]+)@(.*)$/);
  const conn = m ? m[1] + m[2] + ':' + encodeURIComponent(m[3]) + '@' + m[4] : DATABASE_URL;
  const client = new Client({ connectionString: conn });
  await client.connect();

  const EMP_ID = 'DEMOSUP';
  const PHONE = '0877777777';
  const EMAIL = 'demosup@kc-clean.internal';
  const COMPANY_ID = 'comp_kc_clean';

  try {
    let authUserId = null;
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
      const match = (listRes.users || []).find(u => u.email === EMAIL);
      if (!match) throw new Error('Email reported as duplicate but no exact match found in user list');
      authUserId = match.id;
      console.log('Found existing auth user (exact email match):', authUserId);
    } else {
      throw new Error('Auth create failed: ' + JSON.stringify(created));
    }

    const existingEmp = await client.query(`SELECT id FROM public.employees WHERE emp_id = $1 AND company_id = $2 LIMIT 1;`, [EMP_ID, COMPANY_ID]);
    let employeeId;
    if (existingEmp.rows.length > 0) {
      employeeId = existingEmp.rows[0].id;
      console.log('Using existing employees row:', employeeId);
    } else {
      const empRes = await client.query(`
        INSERT INTO public.employees (full_name, emp_id, email, phone_number, company_id, status)
        VALUES ('หัวหน้างานทดสอบสาธิต (Demo)', $1, $2, $3, $4, 'hired')
        RETURNING id;
      `, [EMP_ID, EMAIL, PHONE, COMPANY_ID]);
      employeeId = empRes.rows[0].id;
      console.log('Created employees row:', employeeId);
    }

    const upRes = await client.query(`
      INSERT INTO public.user_profiles (auth_uid, employee_id, company_id, role, status, email, full_name, emp_id)
      VALUES ($1, $2, $3, 'supervisor', 'active', $4, 'หัวหน้างานทดสอบสาธิต (Demo)', $5)
      ON CONFLICT (auth_uid) DO UPDATE SET employee_id = EXCLUDED.employee_id, role = 'supervisor', status = 'active'
      RETURNING id;
    `, [authUserId, employeeId, COMPANY_ID, EMAIL, EMP_ID]);
    const userProfileId = upRes.rows[0].id;
    console.log('user_profiles ready for', EMP_ID, userProfileId);

    const clientRow = await client.query(`SELECT id FROM public.clients WHERE client_name = 'Site A' LIMIT 1;`);
    const siteAId = clientRow.rows[0]?.id;
    if (siteAId) {
      await client.query(`
        INSERT INTO public.supervisor_client_assignments (user_profile_id, client_id, company_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_profile_id, client_id) DO NOTHING;
      `, [userProfileId, siteAId, COMPANY_ID]);
      console.log('Assigned DEMOSUP to supervise Site A');
    } else {
      console.log('⚠️ Site A not found - skipped supervisor_client_assignments');
    }

    console.log('\n✅ Demo supervisor account ready:', EMAIL, '/', PHONE);
  } finally {
    await client.end();
  }
}

run().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
