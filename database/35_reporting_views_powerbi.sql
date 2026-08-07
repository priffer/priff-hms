-- =====================================================
-- database/35_reporting_views_powerbi.sql
-- Phase 4: หน้ารายงาน/Dashboard (OT/เวลาทำงาน) + เชื่อมต่อ Power BI
--
-- สร้าง SQL Views สรุปข้อมูลสำหรับ:
--   1. หน้า in-app dashboard เบาๆ (แอดมินที่ไม่ได้ใช้ Power BI)
--   2. Power BI Desktop ต่อตรงเข้า Supabase Postgres ผ่าน native connector
--      (ไม่ต้องเขียน export/API เพิ่ม - ต่อ view เหล่านี้ตรงๆ)
--
-- ยึดตามที่ยืนยันกับ user แล้ว (ask_user ใน session นี้):
--   - "ขาดงาน" ไม่มี status='absent' เก็บตรงๆ ใน attendance_logs (มีแค่ 'present' จริง) จึงคำนวณ
--     ทางอ้อมด้วยสูตรเดียวกับ fn_run_payroll_period() ใน 27_payroll_engine.sql:
--     expected_workdays (วันในช่วง - วันหยุดบริษัท - วันหยุดประจำสัปดาห์ตามกะ) - worked_days - leave_days
--     ใช้ได้แม่นยำเฉพาะพนักงานที่มี employee_shift_assignments ผูกไว้ (ไม่งั้นไม่มี weekly_rest_day ให้เทียบ)
--   - "มาสาย": นับเฉพาะ record ที่ is_late IS NOT NULL เป็นตัวหาร (ไม่เอา NULL ปนเป็น "ไม่สาย" เพราะ
--     NULL หมายถึง "คำนวณไม่ได้" ไม่ใช่ "ไม่สาย" จริง - เกิดจากไม่มีกะผูกไว้ หรือกะกลางคืนข้ามเที่ยงคืน)
--     จำนวน record ที่คำนวณไม่ได้แสดงแยกเป็นคอลัมน์ unresolved_late_count เพื่อความโปร่งใส
--   - "ลาออก (turnover)": ใช้ employee_movements (movement_type = 'resignation') เป็นหลักตามที่ยืนยันแล้ว
--     แม้ตอนนี้ตาราง employee_movements จะยังไม่มีข้อมูลจริง (0 rows) - view จะโชว์ 0 ไปก่อนจนกว่าจะมีการ
--     บันทึกข้อมูลจริงเข้าตารางนี้ (ไม่ได้ implement fallback ไป employees.status เพราะ user เลือกทางนี้แล้ว)
--
-- Views ทั้งหมดเป็น read-only aggregation (ไม่มี write logic ใดๆ) - ไม่แตะ/ไม่ซ้ำ Payroll Engine
-- calculation logic ตาม .agent-rules.md (Read-only queries against payroll schema is fine)
--
-- Idempotent: CREATE OR REPLACE VIEW เสมอ
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

-- =====================================================
-- VIEW 1: v_attendance_daily_summary
-- ภาพรวมรายวันแยกไซต์: มาทำงานกี่คน, มาสายกี่คน, ทำ OT กี่คน
-- (ขาดงานคำนวณแยกใน v_attendance_absence_summary เพราะต้องคิดเทียบกับ expected_workdays รายช่วง ไม่ใช่รายวันเดี่ยวๆ)
-- =====================================================
CREATE OR REPLACE VIEW public.v_attendance_daily_summary AS
SELECT
  al.company_id,
  al.work_date,
  al.client_id,
  c.client_name,
  COUNT(*) AS present_count,
  COUNT(*) FILTER (WHERE al.is_late IS TRUE) AS late_count,
  COUNT(*) FILTER (WHERE al.is_late IS NOT NULL) AS late_resolved_count,
  COUNT(*) FILTER (WHERE al.is_late IS NULL) AS late_unresolved_count,
  COUNT(DISTINCT aod.employee_id) AS ot_employee_count,
  COALESCE(SUM(al.total_hours), 0) AS total_hours_worked,
  COALESCE(SUM(aod.ot_hours), 0) AS total_ot_hours
FROM public.attendance_logs al
LEFT JOIN public.clients c ON c.id = al.client_id
LEFT JOIN public.attendance_ot_details aod ON aod.attendance_log_id = al.id
GROUP BY al.company_id, al.work_date, al.client_id, c.client_name;

COMMENT ON VIEW public.v_attendance_daily_summary IS
  'Phase 4 reporting: ภาพรวมมาทำงาน/มาสาย/OT รายวันแยกไซต์ (สำหรับ dashboard + Power BI)';

-- =====================================================
-- VIEW 2: v_ot_summary_daily
-- สรุป OT รายวันต่อคนต่อไซต์ (จัดอันดับคนทำ OT มากสุด-น้อยสุดทำได้จาก view นี้ตรงๆ ด้วย ORDER BY)
-- =====================================================
CREATE OR REPLACE VIEW public.v_ot_summary_daily AS
SELECT
  aod.company_id,
  al.work_date,
  al.client_id,
  c.client_name,
  aod.employee_id,
  e.emp_id,
  e.full_name,
  SUM(aod.ot_hours) FILTER (WHERE aod.ot_type = 'ot15') AS ot15_hours,
  SUM(aod.ot_hours) FILTER (WHERE aod.ot_type = 'ot2') AS ot2_hours,
  SUM(aod.ot_hours) FILTER (WHERE aod.ot_type = 'ot3') AS ot3_hours,
  SUM(aod.ot_hours) AS total_ot_hours,
  SUM(aod.ot_amount) AS total_ot_amount
FROM public.attendance_ot_details aod
JOIN public.attendance_logs al ON al.id = aod.attendance_log_id
JOIN public.employees e ON e.id = aod.employee_id
LEFT JOIN public.clients c ON c.id = al.client_id
GROUP BY aod.company_id, al.work_date, al.client_id, c.client_name, aod.employee_id, e.emp_id, e.full_name;

COMMENT ON VIEW public.v_ot_summary_daily IS
  'Phase 4 reporting: สรุป OT รายวันต่อคนต่อไซต์ - รวมรายสัปดาห์/เดือนทำได้โดย GROUP BY date_trunc(...) ฝั่ง Power BI/query ต่อยอด';

-- =====================================================
-- VIEW 3: v_attendance_absence_summary
-- อัตรามาสาย/ขาดงาน รายเดือน แยกพนักงาน+ไซต์
-- ขาดงานใช้สูตรเดียวกับ fn_run_payroll_period(): expected_workdays - worked_days - leave_days
-- คำนวณเฉพาะพนักงานที่มี employee_shift_assignments ผูกไว้ในเดือนนั้น (ไม่งั้นไม่มี weekly_rest_day อ้างอิง)
-- =====================================================
CREATE OR REPLACE VIEW public.v_attendance_absence_summary AS
WITH months AS (
  -- เดือนปฏิทินที่มี attendance_logs หรือ employee_shift_assignments อยู่จริง (ไม่ generate ล่วงหน้าเกินความจำเป็น)
  SELECT DISTINCT date_trunc('month', al.work_date)::date AS month_start, al.company_id
  FROM public.attendance_logs al
  UNION
  SELECT DISTINCT date_trunc('month', esa.effective_from)::date AS month_start, esa.company_id
  FROM public.employee_shift_assignments esa
),
emp_months AS (
  SELECT
    m.company_id,
    m.month_start,
    (m.month_start + interval '1 month' - interval '1 day')::date AS month_end,
    e.id AS employee_id,
    e.emp_id,
    e.full_name
  FROM months m
  JOIN public.employees e ON e.company_id = m.company_id AND e.status IN ('active', 'hired')
),
per_emp AS (
  SELECT
    em.company_id,
    em.month_start,
    em.employee_id,
    em.emp_id,
    em.full_name,
    (
      SELECT COUNT(*)
      FROM generate_series(em.month_start, em.month_end, interval '1 day') d(day)
      WHERE EXISTS (
        SELECT 1 FROM public.employee_shift_assignments esa
        WHERE esa.employee_id = em.employee_id
          AND esa.effective_from <= d.day::date AND (esa.effective_to IS NULL OR esa.effective_to >= d.day::date)
      )
      AND NOT EXISTS (SELECT 1 FROM public.company_holidays ch WHERE ch.company_id = em.company_id AND ch.holiday_date = d.day::date)
      AND NOT EXISTS (
        SELECT 1 FROM public.employee_shift_assignments esa
        WHERE esa.employee_id = em.employee_id
          AND esa.effective_from <= d.day::date AND (esa.effective_to IS NULL OR esa.effective_to >= d.day::date)
          AND esa.weekly_rest_day IS NOT NULL AND esa.weekly_rest_day = EXTRACT(DOW FROM d.day)::integer
      )
    ) AS expected_workdays,
    (
      SELECT COUNT(*) FILTER (WHERE al.total_hours IS NOT NULL)
      FROM public.attendance_logs al
      WHERE al.employee_id = em.employee_id
        AND al.work_date BETWEEN em.month_start AND em.month_end
    ) AS worked_days,
    (
      SELECT COALESCE(SUM(lr.total_days), 0)
      FROM public.leave_requests lr
      WHERE lr.employee_id = em.employee_id AND lr.status = 'approved'
        AND lr.start_date <= em.month_end AND lr.end_date >= em.month_start
    ) AS leave_days,
    (
      SELECT COUNT(*) FILTER (WHERE al.is_late IS TRUE)
      FROM public.attendance_logs al
      WHERE al.employee_id = em.employee_id
        AND al.work_date BETWEEN em.month_start AND em.month_end
    ) AS late_count,
    (
      SELECT COUNT(*) FILTER (WHERE al.is_late IS NOT NULL)
      FROM public.attendance_logs al
      WHERE al.employee_id = em.employee_id
        AND al.work_date BETWEEN em.month_start AND em.month_end
    ) AS late_resolved_count,
    (
      SELECT COUNT(*) FILTER (WHERE al.is_late IS NULL)
      FROM public.attendance_logs al
      WHERE al.employee_id = em.employee_id
        AND al.work_date BETWEEN em.month_start AND em.month_end
    ) AS late_unresolved_count
  FROM emp_months em
  -- เฉพาะพนักงานที่มีกะผูกไว้ในเดือนนั้นจริง (ไม่งั้น expected_workdays ไม่มีความหมาย - จะเป็น 0 เสมอเพราะไม่มี EXISTS shift)
  WHERE EXISTS (
    SELECT 1 FROM public.employee_shift_assignments esa
    WHERE esa.employee_id = em.employee_id
      AND esa.effective_from <= em.month_end AND (esa.effective_to IS NULL OR esa.effective_to >= em.month_start)
  )
)
SELECT
  company_id,
  month_start,
  employee_id,
  emp_id,
  full_name,
  expected_workdays,
  worked_days,
  leave_days,
  GREATEST(expected_workdays - worked_days - leave_days, 0) AS absence_days,
  late_count,
  late_resolved_count,
  late_unresolved_count,
  CASE WHEN late_resolved_count > 0 THEN ROUND(late_count::numeric / late_resolved_count * 100, 2) ELSE NULL END AS late_rate_pct
FROM per_emp;

COMMENT ON VIEW public.v_attendance_absence_summary IS
  'Phase 4 reporting: อัตรามาสาย/ขาดงานรายเดือนต่อพนักงาน - สูตรขาดงานเหมือน fn_run_payroll_period() ทุกประการ (เฉพาะคนที่มีกะผูกไว้)';

-- =====================================================
-- VIEW 4: v_site_headcount_daily
-- Headcount รายวันแยกไซต์ (สำหรับ "วันนี้มาทำงานกี่คน/ไซต์ไหน")
-- =====================================================
CREATE OR REPLACE VIEW public.v_site_headcount_daily AS
SELECT
  al.company_id,
  al.work_date,
  al.client_id,
  c.client_name,
  COUNT(DISTINCT al.employee_id) AS headcount
FROM public.attendance_logs al
LEFT JOIN public.clients c ON c.id = al.client_id
GROUP BY al.company_id, al.work_date, al.client_id, c.client_name;

COMMENT ON VIEW public.v_site_headcount_daily IS
  'Phase 4 reporting: จำนวนคนมาทำงานจริงรายวันแยกไซต์';

-- =====================================================
-- VIEW 5: v_turnover_summary
-- อัตราลาออก (turnover) รายเดือน - อ้างอิง employee_movements(movement_type='resignation')
-- ตามที่ยืนยันกับ user แล้ว แม้ตอนนี้ตารางยังไม่มีข้อมูลจริง (view จะคืน 0 แถวจนกว่าจะมีการบันทึก)
-- =====================================================
CREATE OR REPLACE VIEW public.v_turnover_summary AS
SELECT
  em.company_id,
  date_trunc('month', em.effective_date)::date AS month_start,
  COUNT(*) AS resignation_count
FROM public.employee_movements em
WHERE em.movement_type = 'resignation'
GROUP BY em.company_id, date_trunc('month', em.effective_date)::date;

COMMENT ON VIEW public.v_turnover_summary IS
  'Phase 4 reporting: จำนวนพนักงานลาออกรายเดือน อ้างอิง employee_movements.movement_type = ''resignation''';

-- =====================================================
-- Grants: ให้ authenticated (แอดมิน/payroll) เข้าถึง view ผ่าน RLS ปกติของ underlying tables
-- (Postgres views เป็น security_invoker by default หากไม่ได้ตั้งเป็น SECURITY DEFINER function
-- ดังนั้น RLS ของ attendance_logs/employees เดิมยังบังคับใช้ปกติผ่าน view เหล่านี้)
-- =====================================================
GRANT SELECT ON public.v_attendance_daily_summary TO authenticated;
GRANT SELECT ON public.v_ot_summary_daily TO authenticated;
GRANT SELECT ON public.v_attendance_absence_summary TO authenticated;
GRANT SELECT ON public.v_site_headcount_daily TO authenticated;
GRANT SELECT ON public.v_turnover_summary TO authenticated;

-- =====================================================
-- Power BI read-only role
-- แยก role เฉพาะสำหรับ Power BI Desktop ต่อผ่าน native PostgreSQL connector โดยตรง (ไม่ใช้
-- service_role key เต็มสิทธิ์ของ Supabase) - ให้สิทธิ์ SELECT เฉพาะ 5 views ด้านบนเท่านั้น
-- (ไม่ให้เข้าถึงตารางดิบโดยตรง เพื่อจำกัด surface area และไม่ให้เห็นข้อมูลอ่อนไหวอื่นๆ เช่น
-- id_card_number, เงินเดือนรายละเอียด ที่ไม่จำเป็นสำหรับรายงาน OT/เวลาทำงาน)
--
-- หลังรัน migration นี้ ต้องตั้งรหัสผ่านเองแยกต่างหาก (ไม่ hardcode รหัสผ่านในไฟล์ migration
-- ที่เป็น version-controlled) ด้วยคำสั่ง:
--   ALTER ROLE powerbi_readonly WITH PASSWORD '<เลือกรหัสผ่านที่ปลอดภัยเอง>';
-- แล้วใช้ connection string ต่อ Power BI Desktop (Get Data > PostgreSQL database):
--   Server: db.hcyibcqojsyldiyzperr.supabase.co, Port: 5432, Database: postgres, User: powerbi_readonly
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_readonly') THEN
    CREATE ROLE powerbi_readonly WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE postgres TO powerbi_readonly;
GRANT USAGE ON SCHEMA public TO powerbi_readonly;
GRANT SELECT ON public.v_attendance_daily_summary TO powerbi_readonly;
GRANT SELECT ON public.v_ot_summary_daily TO powerbi_readonly;
GRANT SELECT ON public.v_attendance_absence_summary TO powerbi_readonly;
GRANT SELECT ON public.v_site_headcount_daily TO powerbi_readonly;
GRANT SELECT ON public.v_turnover_summary TO powerbi_readonly;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT viewname FROM pg_views WHERE schemaname='public' AND viewname LIKE 'v_%';
-- SELECT * FROM public.v_attendance_daily_summary ORDER BY work_date DESC LIMIT 10;
-- SELECT * FROM public.v_ot_summary_daily ORDER BY total_ot_hours DESC LIMIT 10;
-- SELECT * FROM public.v_attendance_absence_summary ORDER BY month_start DESC LIMIT 10;
-- SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'powerbi_readonly';
-- SELECT grantee, privilege_type, table_name FROM information_schema.role_table_grants WHERE grantee = 'powerbi_readonly';
