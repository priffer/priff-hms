# Staging Execution Guide — รัน migration บน Supabase Staging

เอกสารนี้สรุปขั้นตอนปฏิบัติสำหรับ DBA / Developer ในการนำสคริปต์ `database/01_payroll_migration_v2.sql` ไปรันบน Supabase Staging Environment และรายการตรวจสอบหลังรัน

ข้อกำหนดเบื้องต้น
- ต้องมี snapshot/staging DB ที่เป็นสำเนาของ production (read-only copy ก่อน migration)
- ผู้รันต้องมีสิทธิ์ DBA (CREATE/ALTER/TRIGGER/SECURITY DEFINER)
- ตรวจสอบว่ามีสำรองข้อมูล (pg_dump) และไฟล์สำรองถูกเก็บในที่ปลอดภัย
- ควรเลือก maintenance window สำหรับงานที่อาจใช้เวลานาน

---

ขั้นตอนการรัน (Step-by-step)

1) Preparation
- ตรวจสอบเวอร์ชันไฟล์: `git show --name-only -- database/01_payroll_migration_v2.sql`
- อ่านสคริปต์ทั้งหมด และ review กับ DBA/Lead Developer
- แจ้งทีม: DevOps, QA, Payroll SME, Product Owner วันและเวลาที่จะรัน

2) Backup
- Full logical dump:
  pg_dump --format=custom --file=backup_before_payroll_$(date +%Y%m%d%H%M).dump "postgres://<user>:<pass>@<host>:<port>/<db>"
- Export critical tables separately (optional): employees, attendance_logs, advance_payments

3) Run migration script on Staging (single transaction parts)
- แนะนำรันเป็นสองขั้นตอน: PARTS ที่ไม่หนัก (schema + functions + policies) และ PARTS ที่อาจต้อง backfill แยก batch

Command (psql or supabase CLI):
- psql "postgresql://<user>:<pass>@<host>:<port>/<db>" -f database/01_payroll_migration_v2.sql

หมายเหตุ:
- หากสคริปต์ใหญ่และเกิด lock ให้ยกเลิกและรันเป็นส่วนย่อยตาม PART
- ตรวจสอบ logs และ error messages อย่างละเอียด

4) Immediate Verification (หลัง COMMIT)
- ตรวจสอบว่า tables ถูกสร้างขึ้น:
  SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN (
    'user_profiles','supervisor_client_assignments','attendance_ot_details','attendance_audit_logs','payroll_periods','payroll_runs','payroll_lines','payroll_line_details','payroll_payslips','payroll_rates','payroll_ytd_summary'
  );

- ตรวจสอบ functions:
  SELECT proname FROM pg_proc WHERE proname IN ('get_user_profile_id','get_user_company','get_user_role','is_active_user','fn_compute_iso_week_and_weekly_ot','fn_attendance_audit','fn_attendance_modify_allowed');

- ตรวจสอบ triggers on attendance_logs:
  SELECT tgname, tgtype::integer, tgrelid::regclass FROM pg_trigger WHERE tgrelid = 'public.attendance_logs'::regclass;

5) Data Integrity Quick-Checks (ตัวอย่าง SQL สำหรับสุ่มตรวจ)

-- 5.1 ตรวจสอบพนักงานตัวอย่างและค่า payroll fields
SELECT id, emp_id, salary_type, monthly_salary, daily_rate FROM public.employees WHERE emp_id IS NOT NULL LIMIT 10;

-- 5.2 ตรวจสอบ user_profiles mapping
SELECT up.id, up.auth_uid, up.employee_id, e.emp_id, up.role FROM public.user_profiles up LEFT JOIN public.employees e ON up.employee_id = e.id LIMIT 20;

-- 5.3 ตรวจสอบ attendance iso_week และ weekly flag
SELECT emp_id, work_date, iso_week, weekly_ot_hours, weekly_ot_flagged FROM public.attendance_logs WHERE weekly_ot_flagged = true LIMIT 50;

-- 5.4 ตรวจสอบ OT details consistency
SELECT aod.id, al.emp_id, aod.ot_type, aod.ot_hours FROM public.attendance_ot_details aod JOIN public.attendance_logs al ON al.id = aod.attendance_log_id LIMIT 50;

-- 5.5 ตรวจสอบ advance_payments linkage
SELECT id, emp_id, amount, deducted_in_payroll_run_id, deducted_amount FROM public.advance_payments WHERE deducted_in_payroll_run_id IS NOT NULL LIMIT 50;

-- 5.6 ตรวจสอบ payroll tables empty-or-ready
SELECT COUNT(*) FROM public.payroll_periods;
SELECT COUNT(*) FROM public.payroll_runs;
SELECT COUNT(*) FROM public.payroll_lines;

6) RLS Policy Sanity Tests
- ใช้ test accounts (employee, supervisor, payroll, admin) ใน Supabase Auth ที่เชื่อมกับ user_profiles
- ตัวอย่างตรวจสอบ (ด้วย Supabase client per role) ให้รันคำสั่งต่อไปนี้และยืนยันทดสอบผลลัพธ์:
  - employee ลงชื่อเข้าใช้ แล้วรัน SELECT on attendance_logs (ต้องเห็นเฉพาะของตัวเอง)
  - supervisor ลงชื่อเข้าใช้ แล้วรัน SELECT on attendance_logs ของพนักงานใน site ที่มอบหมาย
  - payroll role อ่าน payroll_runs และ payroll_lines
  - employee พยายาม SELECT payroll_lines โดยตรง (ควรถูกปฏิเสธ)

7) Backfill (Batch jobs) — แนะนำ
- Populate company_id สำหรับ records ที่ยังไม่มี:
  UPDATE public.employees SET company_id = 'comp_kc_clean' WHERE company_id IS NULL;
  UPDATE public.attendance_logs SET company_id = (SELECT company_id FROM public.employees WHERE emp_id = attendance_logs.emp_id LIMIT 1) WHERE company_id IS NULL;

- Populate user_profiles mapping (ตัวอย่าง skeleton):
  -- สร้าง user_profiles สำหรับ employees ที่ยังไม่มี
  INSERT INTO public.user_profiles (auth_uid, employee_id, company_id, role, status, email, full_name, emp_id)
  SELECT gen_random_uuid(), e.id, e.company_id, 'employee', 'active', COALESCE(e.email, concat(e.emp_id, '@synthetic.priff')), e.full_name, e.emp_id
  FROM public.employees e
  WHERE NOT EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.employee_id = e.id);

- Compute iso_week and weekly_ot_hours in batch (example approach):
  -- update iso_week for attendance_logs
  UPDATE public.attendance_logs SET iso_week = to_char(work_date, 'IW')::integer WHERE iso_week IS NULL;

  -- recompute weekly_ot_hours from attendance_ot_details
  WITH sums AS (
    SELECT al.emp_id, al.company_id, al.iso_week, COALESCE(SUM(aod.ot_hours),0) AS sum_ot
    FROM public.attendance_ot_details aod
    JOIN public.attendance_logs al ON al.id = aod.attendance_log_id
    GROUP BY al.emp_id, al.company_id, al.iso_week
  )
  UPDATE public.attendance_logs al SET weekly_ot_hours = s.sum_ot, weekly_ot_flagged = (s.sum_ot > 36)
  FROM sums s
  WHERE al.emp_id = s.emp_id AND al.company_id = s.company_id AND al.iso_week = s.iso_week;

8) Post-Run Verification & Sign-off
- QA runs full set of tests (functional, RLS, security)
- Payroll SME validates sample payroll calculation manually
- Security team runs RLS test scenarios and basic PenTest
- Stakeholder sign-off to proceed to next Milestone

---

Rollback considerations (Staging)
- หากมี error ก่อน commit: ROLLBACK
- หากได้ COMMIT และต้อง revert: restore from backup dump created earlier
- Keep detailed logs of migration run and queries executed

---

Common Troubleshooting
- Long locks during index creation: consider CREATE INDEX CONCURRENTLY in non-transactional runs
- Permission errors for SECURITY DEFINER functions: ensure function owner is a role with appropriate privileges
- RLS policies denying admin: verify that test admin user_profiles.role='admin' and company_id matches

---

Appendix: Quick SQL Snippets
- List policies for a table:
  SELECT policyname, schemaname, tablename, cmd, permissive, roles FROM pg_policies WHERE tablename = 'attendance_logs';

- Check triggers for a table:
  SELECT tgname, tgenabled, tgtype FROM pg_trigger WHERE tgrelid = 'public.attendance_logs'::regclass;

- Verify user_profiles population count:
  SELECT role, COUNT(*) FROM public.user_profiles GROUP BY role;


---

เอกสารนี้ออกแบบสำหรับทีมปฏิบัติการ/DBA เพื่อให้รัน migration บน Staging อย่างปลอดภัย — ห้ามนำขั้นตอนนี้ไปรันบน Production โดยไม่ผ่านการทดสอบและอนุมัติครบถ้วน
