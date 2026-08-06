// scripts/setup-demo-account.js
// สร้างบัญชีสาธิต (DEMO001) + ข้อมูลตัวอย่างสำหรับ demo ฟีเจอร์ ESS ทั้งหมด
// ใช้ SERVICE_ROLE_KEY จาก .env เพื่อสร้าง Supabase Auth user ผ่าน Admin API
// เป็นข้อมูลใหม่ทั้งหมด ไม่แตะ/ลบข้อมูลเดิมที่มีอยู่ (additive only, สำหรับ demo เท่านั้น)
const { Client } = require('pg');
const { getConfig } = require('./lib/env.js');

async function run() {
  const { DATABASE_URL, SERVICE_KEY, PROJECT_URL } = getConfig();
  const m = DATABASE_URL.match(/^(.*?:\/\/)([^:\/\?#]+):([^@]+)@(.*)$/);
  const conn = m ? m[1] + m[2] + ':' + encodeURIComponent(m[3]) + '@' + m[4] : DATABASE_URL;
  const client = new Client({ connectionString: conn });
  await client.connect();

  const EMP_ID = 'DEMO001';
  const PHONE = '0899999999';
  const EMAIL = 'demo001@kc-clean.internal';
  const COMPANY_ID = 'comp_kc_clean';

  try {
    // 1. สร้าง Supabase Auth user ใหม่ (หมายเหตุ: GoTrue admin GET /users ไม่รองรับ query param
    // ?email= จริง - จะคืน user ทั้งหมดแบบไม่กรอง ต้องกรอง exact match เองฝั่ง client)
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
      // ค้นหา user ที่ตรง email เป๊ะๆ ด้วยตัวเอง (ไม่พึ่ง query param filter ของ GoTrue)
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

    // 2. employees row (guard manually - no unique constraint on emp_id to rely on ON CONFLICT)
    const existingEmp = await client.query(`SELECT id FROM public.employees WHERE emp_id = $1 AND company_id = $2 LIMIT 1;`, [EMP_ID, COMPANY_ID]);
    let employeeId;
    if (existingEmp.rows.length > 0) {
      employeeId = existingEmp.rows[0].id;
      console.log('Using existing employees row:', employeeId);
      // ตั้ง available_start_date ให้ด้วยถ้ายังไม่มี (จำเป็นสำหรับ demo ฟีเจอร์ลาพักร้อนตามอายุงาน/ระเบียบที่ 7)
      await client.query(`UPDATE public.employees SET available_start_date = COALESCE(available_start_date, '2020-03-10') WHERE id = $1;`, [employeeId]);
    } else {
      const empRes = await client.query(`
        INSERT INTO public.employees (full_name, emp_id, email, phone_number, company_id, status, available_start_date)
        VALUES ('พนักงานทดสอบสาธิต (Demo)', $1, $2, $3, $4, 'hired', '2020-03-10')
        RETURNING id;
      `, [EMP_ID, EMAIL, PHONE, COMPANY_ID]);
      employeeId = empRes.rows[0].id;
      console.log('Created employees row:', employeeId);
    }

    // 3. user_profiles row (upsert by auth_uid)
    await client.query(`
      INSERT INTO public.user_profiles (auth_uid, employee_id, company_id, role, status, email, full_name, emp_id)
      VALUES ($1, $2, $3, 'employee', 'active', $4, 'พนักงานทดสอบสาธิต (Demo)', $5)
      ON CONFLICT (auth_uid) DO UPDATE SET employee_id = EXCLUDED.employee_id, status = 'active';
    `, [authUserId, employeeId, COMPANY_ID, EMAIL, EMP_ID]);
    console.log('user_profiles ready for', EMP_ID);

    // 4. Sample data for a richer demo (idempotent-ish, guarded by NOT EXISTS)
    const clientRow = await client.query(`SELECT id FROM public.clients WHERE client_name = 'Site A' LIMIT 1;`);
    const clientId = clientRow.rows[0]?.id;

    await client.query(`
      INSERT INTO public.advance_payments (emp_id, company_id, amount, status, employee_remark)
      SELECT $1, $2, 1500, 'pending', 'ขอเบิกล่วงหน้าเพื่อค่าเช่าบ้าน'
      WHERE NOT EXISTS (SELECT 1 FROM public.advance_payments WHERE emp_id = $1);
    `, [EMP_ID, COMPANY_ID]);

    const leaveType = await client.query(`SELECT id FROM public.leave_types WHERE code = 'annual' AND company_id = $1 LIMIT 1;`, [COMPANY_ID]);
    if (leaveType.rows.length > 0) {
      await client.query(`
        INSERT INTO public.leave_requests (company_id, employee_id, emp_id, leave_type_id, start_date, end_date, total_days, reason, status)
        SELECT $1, $2, $3, $4, CURRENT_DATE + 7, CURRENT_DATE + 8, 2, 'พักผ่อนประจำปี', 'pending'
        WHERE NOT EXISTS (SELECT 1 FROM public.leave_requests WHERE emp_id = $3);
      `, [COMPANY_ID, employeeId, EMP_ID, leaveType.rows[0].id]);
    }

    if (clientId) {
      await client.query(`
        INSERT INTO public.attendance_logs (emp_id, client_id, work_date, check_in, check_out, status, check_in_method)
        SELECT $1, $2, CURRENT_DATE - 1, '08:02:00', '17:05:00', 'present', 'mobile'
        WHERE NOT EXISTS (SELECT 1 FROM public.attendance_logs WHERE emp_id = $1 AND work_date = CURRENT_DATE - 1);
      `, [EMP_ID, clientId]);
      await client.query(`
        INSERT INTO public.attendance_logs (emp_id, client_id, work_date, check_in, check_out, status, check_in_method)
        SELECT $1, $2, CURRENT_DATE - 2, '07:58:00', '17:10:00', 'present', 'mobile'
        WHERE NOT EXISTS (SELECT 1 FROM public.attendance_logs WHERE emp_id = $1 AND work_date = CURRENT_DATE - 2);
      `, [EMP_ID, clientId]);
    }

    await client.query(`
      INSERT INTO public.announcements (company_id, title, body, category, is_pinned, published_at, target_roles)
      SELECT $1, 'ประชุมพนักงานประจำเดือน', 'ขอเชิญพนักงานทุกท่านเข้าร่วมประชุมประจำเดือนที่ห้องประชุมใหญ่ วันศุกร์นี้ เวลา 14:00 น.', 'general', true, now(), NULL
      WHERE NOT EXISTS (SELECT 1 FROM public.announcements WHERE title = 'ประชุมพนักงานประจำเดือน' AND company_id = $1);
    `, [COMPANY_ID]);
    await client.query(`
      INSERT INTO public.announcements (company_id, title, body, category, is_pinned, published_at, target_roles)
      SELECT $1, 'ปรับปรุงระเบียบสวัสดิการเบี้ยขยัน', 'บริษัทปรับปรุงเงื่อนไขเบี้ยขยันใหม่ เริ่มมีผลเดือนหน้า รายละเอียดตามเอกสารแนบ', 'benefit', false, now(), '["employee"]'::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM public.announcements WHERE title = 'ปรับปรุงระเบียบสวัสดิการเบี้ยขยัน' AND company_id = $1);
    `, [COMPANY_ID]);

    if (clientId) {
      await client.query(`
        INSERT INTO public.client_holidays (company_id, client_id, holiday_date, name_th)
        SELECT $1, $2, CURRENT_DATE + 14, 'วันหยุดประจำปีของไซต์ลูกค้า Site A'
        WHERE NOT EXISTS (SELECT 1 FROM public.client_holidays WHERE client_id = $2 AND holiday_date = CURRENT_DATE + 14);
      `, [COMPANY_ID, clientId]);
    }

    console.log('\n✅ Demo account ready:');
    console.log('   emp_id / password (phone):', EMP_ID, '/', PHONE);
    console.log('   Login at employee-login.html with these credentials.');
  } finally {
    await client.end();
  }
}

run().catch(err => { console.error('Fatal error:', err.message); process.exit(1); });
