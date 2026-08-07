-- =====================================================
-- database/22_advance_payment_estimate_summary.sql
-- ขอเบิกเงินล่วงหน้า (รอบอัพเกรด): แสดง "ยอดสะสมประมาณการ" ให้พนักงานเห็นก่อนขอเบิก
--
-- บริบท (ตัดสินใจร่วมกับ user ผ่าน ask_user ใน session นี้):
--   - Payroll Engine จริง (payroll_runs/payroll_lines) ยังไม่มีโค้ดคำนวณ (มีแค่ schema เปล่า
--     จาก 01_payroll_migration_v2.sql) ผู้ใช้เลือกให้ทำตัวเลข "ประมาณการ" (estimate) สดจาก
--     attendance_logs/attendance_ot_details/leave_requests ไปก่อนเลย แทนที่จะรอ Payroll Engine
--     เสร็จ โดยต้อง label ชัดเจนว่าเป็นตัวเลขประมาณการ ไม่ใช่ยอดจริงจากสลิปเงินเดือน (ลดความ
--     เสี่ยงข้อพิพาทแรงงานที่เคยกังวลไว้ตอนตัดสินใจ defer ใน 11_advance_payment_eligibility.sql)
--   - เพดานเบิก (soft cap, ไม่บังคับ - admin ตัดสินใจตอนอนุมัติเองได้เสมอ): 30% ของยอดค่าแรง
--     ที่พึงได้สะสม (estimate) ตั้งแต่ต้นงวด (ต้นเดือนปฏิทิน) ถึงวันนี้ หักด้วยยอดที่เบิกไปแล้ว
--     ในงวดเดียวกัน (pending + approved, ไม่นับ rejected/cancelled)
--
-- อัตราค่าแรง/ชม. ที่ใช้ประมาณการ (อ้างอิง docs/payroll-architecture.md §4.1, §4.2):
--   - salary_type = 'monthly': hourly = monthly_salary / standard_monthly_hours
--   - salary_type = 'daily'  : hourly = daily_rate / standard_working_hours (ถ้าไม่มี standard_working_hours ใช้ 8)
--   - ถ้าพนักงานยังไม่ตั้งค่าเงินเดือน/เรทเลย (salary_type ว่าง) -> คืน has_salary_config=false
--     ให้ฝั่ง UI ซ่อนตัวเลขเงิน แสดงแค่ยอดวันทำงาน/OT/ลา/สาย แทน
--   - OT แยกประเภทจาก attendance_ot_details.ot_type ('ot15','ot2','ot3') คำนวณค่าแรง OT เองสด
--     จาก hourly * ot_rate_multiplier (ไม่ใช้ ot_amount ที่เก็บไว้ในตาราง เพราะเป็นค่าที่ยังไม่ได้
--     คำนวณจริงจาก Payroll Engine - อาจเป็น 0 หรือไม่ตรง)
--
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP FUNCTION IF EXISTS ก่อนสร้างใหม่เสมอ
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

BEGIN;

DROP FUNCTION IF EXISTS public.fn_get_advance_payment_estimate_summary();
CREATE OR REPLACE FUNCTION public.fn_get_advance_payment_estimate_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_up public.user_profiles%ROWTYPE;
  v_emp public.employees%ROWTYPE;
  v_period_start date := date_trunc('month', CURRENT_DATE)::date;
  v_period_end date := CURRENT_DATE;
  v_hourly_rate numeric;
  v_has_salary_config boolean := false;
  v_worked_days integer := 0;
  v_late_count integer := 0;
  v_leave_days numeric := 0;
  v_ot15_hours numeric := 0;
  v_ot2_hours numeric := 0;
  v_ot3_hours numeric := 0;
  v_base_earned numeric := 0;
  v_ot_earned numeric := 0;
  v_total_estimated numeric := 0;
  v_already_requested numeric := 0;
  v_cap_percent numeric := 0.30; -- 30% ตามที่ user เลือก
  v_available numeric := 0;
BEGIN
  SELECT * INTO v_up FROM public.user_profiles up WHERE up.auth_uid = auth.uid() LIMIT 1;
  IF v_up.id IS NULL OR v_up.employee_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_profile');
  END IF;

  SELECT * INTO v_emp FROM public.employees e WHERE e.id = v_up.employee_id LIMIT 1;
  IF v_emp.id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_employee');
  END IF;

  -- วันทำงาน (นับวันที่มี check_in จริง สถานะ present)
  SELECT COUNT(DISTINCT al.work_date) INTO v_worked_days
  FROM public.attendance_logs al
  WHERE al.emp_id = v_emp.emp_id
    AND al.work_date BETWEEN v_period_start AND v_period_end
    AND al.status = 'present';

  -- มาสาย (นับจำนวนครั้ง ใช้ is_late จาก 17_leave_hourly_and_late_tracking.sql)
  SELECT COUNT(*) INTO v_late_count
  FROM public.attendance_logs al
  WHERE al.emp_id = v_emp.emp_id
    AND al.work_date BETWEEN v_period_start AND v_period_end
    AND al.is_late IS TRUE;

  -- วันลาที่อนุมัติแล้วในงวดนี้
  SELECT COALESCE(SUM(lr.total_days), 0) INTO v_leave_days
  FROM public.leave_requests lr
  WHERE lr.employee_id = v_emp.id
    AND lr.status = 'approved'
    AND lr.start_date <= v_period_end
    AND lr.end_date >= v_period_start;

  -- OT แยกประเภท (ot15/ot2/ot3) จาก attendance_ot_details ที่ผูกกับ attendance_logs ในงวดนี้
  SELECT
    COALESCE(SUM(aod.ot_hours) FILTER (WHERE aod.ot_type = 'ot15'), 0),
    COALESCE(SUM(aod.ot_hours) FILTER (WHERE aod.ot_type = 'ot2'), 0),
    COALESCE(SUM(aod.ot_hours) FILTER (WHERE aod.ot_type = 'ot3'), 0)
  INTO v_ot15_hours, v_ot2_hours, v_ot3_hours
  FROM public.attendance_ot_details aod
  JOIN public.attendance_logs al ON al.id = aod.attendance_log_id
  WHERE al.emp_id = v_emp.emp_id
    AND al.work_date BETWEEN v_period_start AND v_period_end;

  -- อัตราค่าแรง/ชม. โดยประมาณ ตาม salary_type (docs/payroll-architecture.md §4.1)
  IF v_emp.salary_type = 'monthly' AND v_emp.monthly_salary IS NOT NULL AND COALESCE(v_emp.standard_monthly_hours, 0) > 0 THEN
    v_hourly_rate := v_emp.monthly_salary / v_emp.standard_monthly_hours;
    v_has_salary_config := true;
    v_base_earned := (v_emp.monthly_salary / GREATEST(EXTRACT(DAY FROM (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day'))::numeric, 1)) * v_worked_days;
  ELSIF v_emp.salary_type = 'daily' AND v_emp.daily_rate IS NOT NULL THEN
    v_hourly_rate := v_emp.daily_rate / GREATEST(COALESCE(v_emp.standard_working_hours, 8), 1);
    v_has_salary_config := true;
    v_base_earned := v_emp.daily_rate * v_worked_days;
  ELSE
    v_hourly_rate := NULL;
    v_has_salary_config := false;
  END IF;

  IF v_has_salary_config THEN
    v_ot_earned := (v_ot15_hours * 1.5 * v_hourly_rate) + (v_ot2_hours * 2.0 * v_hourly_rate) + (v_ot3_hours * 3.0 * v_hourly_rate);
    v_total_estimated := ROUND(v_base_earned + v_ot_earned, 2);
  ELSE
    v_total_estimated := 0;
  END IF;

  -- ยอดที่ขอเบิกไปแล้วในงวดนี้ (นับ pending + approved เท่านั้น ไม่นับ rejected/cancelled)
  SELECT COALESCE(SUM(ap.amount), 0) INTO v_already_requested
  FROM public.advance_payments ap
  WHERE ap.emp_id = v_emp.emp_id
    AND ap.status IN ('pending', 'approved')
    AND ap.created_at >= v_period_start;

  v_available := GREATEST(0, ROUND(v_total_estimated * v_cap_percent - v_already_requested, 2));

  RETURN jsonb_build_object(
    'has_salary_config', v_has_salary_config,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'worked_days', v_worked_days,
    'late_count', v_late_count,
    'leave_days', v_leave_days,
    'ot15_hours', v_ot15_hours,
    'ot2_hours', v_ot2_hours,
    'ot3_hours', v_ot3_hours,
    'estimated_earned_total', v_total_estimated,
    'cap_percent', v_cap_percent,
    'already_requested_this_period', v_already_requested,
    'available_to_request', v_available,
    'is_estimate', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_advance_payment_estimate_summary() TO authenticated;

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT proname FROM pg_proc WHERE proname = 'fn_get_advance_payment_estimate_summary';
-- -- ทดสอบ (ต้อง login เป็นผู้ใช้จริงผ่าน RLS/JWT เพื่อให้ auth.uid() มีค่า):
-- -- SELECT public.fn_get_advance_payment_estimate_summary();
