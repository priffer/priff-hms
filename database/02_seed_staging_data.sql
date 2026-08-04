-- 02_seed_staging_data.sql
-- Seed data สำหรับ Staging (company_id = 'comp_kc_clean')
-- หมายเหตุ: สคริปต์นี้เพิ่มข้อมูลตัวอย่างในตาราง application-level เท่านั้น
-- (การสร้างผู้ใช้ Supabase Auth ต้องทำแยกผ่าน Admin API หรือ supabase.auth.admin.createUser)

BEGIN;

-- ตัวอย่าง client / site (idempotent)
INSERT INTO public.clients (id, client_name, location, contact_person, created_at)
SELECT gen_random_uuid(), v.client_name, v.location, v.contact_person, timezone('utc', now())
FROM (VALUES ('Site A','Bangkok','Ms. Somchai'),('Site B','Samutprakarn','Mr. Anan')) AS v(client_name, location, contact_person)
WHERE NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.client_name = v.client_name);

-- สร้าง employees ตัวอย่าง (4 บทบาท: admin, payroll, supervisor, employee) (idempotent)
INSERT INTO public.employees (id, full_name, emp_id, email, phone_number, company_id, department_id, status, created_at, available_start_date)
SELECT gen_random_uuid(), v.full_name, v.emp_id, v.email, v.phone_number, v.company_id, NULL, 'active', timezone('utc', now()), NULL
FROM (VALUES
  ('Admin User','ADM001','admin@comp.kc','000-000-0000','comp_kc_clean'),
  ('Payroll User','PAY001','payroll@comp.kc','000-000-0001','comp_kc_clean'),
  ('Supervisor User','SUP001','supervisor@comp.kc','000-000-0002','comp_kc_clean'),
  ('Employee User','EMP001','employee@comp.kc','000-000-0003','comp_kc_clean')
) AS v(full_name, emp_id, email, phone_number, company_id)
WHERE NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.emp_id = v.emp_id AND e.company_id = v.company_id);

-- สร้าง user_profiles สำหรับ mapping identity -> employee (idempotent)
-- auth_uid ต้องอัปเดตจริงจาก Supabase Auth หลังสร้างผู้ใช้ด้วย Admin API
INSERT INTO public.user_profiles (id, auth_uid, employee_id, company_id, role, status, email, full_name, emp_id, created_at)
SELECT gen_random_uuid(), gen_random_uuid(), e.id, e.company_id,
  CASE e.emp_id
    WHEN 'ADM001' THEN 'admin'
    WHEN 'PAY001' THEN 'payroll'
    WHEN 'SUP001' THEN 'supervisor'
    ELSE 'employee'
  END,
  'active', e.email, e.full_name, e.emp_id, timezone('utc', now())
FROM public.employees e
WHERE e.emp_id IN ('ADM001','PAY001','SUP001','EMP001')
AND NOT EXISTS (
  SELECT 1 FROM public.user_profiles up WHERE up.employee_id = e.id
);

-- สร้างการผูก supervisor -> client (assign Supervisor User to Site A) (idempotent)
-- หาค่า user_profile_id ของ SUP001
INSERT INTO public.supervisor_client_assignments (id, user_profile_id, client_id, company_id, assigned_at)
SELECT gen_random_uuid(), up.id, c.id, 'comp_kc_clean', timezone('utc', now())
FROM public.user_profiles up
JOIN public.employees e ON up.employee_id = e.id
JOIN public.clients c ON c.client_name = 'Site A'
WHERE up.emp_id = 'SUP001'
AND NOT EXISTS (
  SELECT 1 FROM public.supervisor_client_assignments sca WHERE sca.user_profile_id = up.id AND sca.client_id = c.id
)
LIMIT 1;

-- สร้างตัวอย่าง attendance_logs และ attendance_ot_details สำหรับ EMP001 (ตัวอย่างข้อมูลเล็กๆ)
WITH emp AS (
  SELECT id, emp_id, company_id FROM public.employees WHERE emp_id = 'EMP001' LIMIT 1
), client AS (
  SELECT id FROM public.clients WHERE client_name = 'Site A' LIMIT 1
)
-- Insert attendance log only if not exists for emp_id + work_date + client
INSERT INTO public.attendance_logs (id, emp_id, client_id, work_date, check_in, check_out, total_hours, ot_hours, status, created_at, company_id)
SELECT gen_random_uuid(), emp.emp_id, client.id, CURRENT_DATE - 7, '08:00', '17:00', 9.0, 1.0, 'present', timezone('utc', now()), emp.company_id
FROM emp, client
WHERE NOT EXISTS (
  SELECT 1 FROM public.attendance_logs al WHERE al.emp_id = emp.emp_id AND al.work_date = CURRENT_DATE - 7 AND al.client_id = client.id
);

-- Insert OT detail for the attendance created above
-- Insert OT detail only if not exists for attendance_log_id + ot_type
INSERT INTO public.attendance_ot_details (id, attendance_log_id, employee_id, company_id, ot_type, ot_hours, ot_rate_multiplier, ot_amount, created_at)
SELECT gen_random_uuid(), al.id, emp.id, emp.company_id, 'ot15', 1.0, 1.5, 0.0, timezone('utc', now())
FROM public.attendance_logs al
JOIN public.employees emp ON emp.emp_id = al.emp_id
WHERE emp.emp_id = 'EMP001'
AND NOT EXISTS (
  SELECT 1 FROM public.attendance_ot_details aod WHERE aod.attendance_log_id = al.id AND aod.ot_type = 'ot15'
)
LIMIT 1;


-- Ensure at least one payroll_period and payroll_run exist for company (idempotent)
WITH existing_period AS (
  SELECT id FROM public.payroll_periods WHERE company_id = 'comp_kc_clean' ORDER BY period_start DESC LIMIT 1
), created_period AS (
  INSERT INTO public.payroll_periods (id, company_id, period_type, period_start, period_end, pay_date, status, created_at)
  SELECT gen_random_uuid(), 'comp_kc_clean', 'monthly', date_trunc('month', CURRENT_DATE)::date, (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date, CURRENT_DATE + INTERVAL '7 day', 'draft', timezone('utc', now())
  WHERE NOT EXISTS (SELECT 1 FROM public.payroll_periods WHERE company_id = 'comp_kc_clean')
  RETURNING id
)
INSERT INTO public.payroll_runs (id, period_id, company_id, run_name, run_type, run_date, status, created_at)
SELECT gen_random_uuid(), COALESCE((SELECT id FROM created_period), (SELECT id FROM existing_period)), 'comp_kc_clean', 'Initial Run', 'full', timezone('utc', now()), 'draft', timezone('utc', now())
WHERE NOT EXISTS (
  SELECT 1 FROM public.payroll_runs pr WHERE pr.company_id = 'comp_kc_clean' AND pr.status = 'draft'
);

COMMIT;

-- NOTES (ภาษาไทย):
-- 1) auth_uid ใน user_profiles ถูกตั้งค่าเป็น UUID placeholder ที่สร้างขึ้นด้วย gen_random_uuid()
--    หลังจากสร้างผู้ใช้จริงใน Supabase Auth (ผ่าน Admin API) ให้อัพเดตค่า user_profiles.auth_uid ให้ตรงกับ auth.users.id ของผู้ใช้แต่ละคน
-- 2) การสร้าง Supabase Auth users ควรทำด้วยคำสั่ง Admin API หรือ CLI และต้องจับคู่ auth_uid เข้ากับ user_profiles
-- 3) ห้ามรันสคริปต์นี้บน production โดยไม่ผ่าน staging/QA
