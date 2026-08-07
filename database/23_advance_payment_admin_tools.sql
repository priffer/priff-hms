-- =====================================================
-- database/23_advance_payment_admin_tools.sql
-- ขอเบิกเงินล่วงหน้า (รอบอัพเกรดต่อ): เพิ่ม 3 ฟีเจอร์ที่เสนอเพิ่มหลัง 22_advance_payment_estimate_summary.sql
--   1) แจ้งเตือน admin/payroll เมื่อคำขอเบิกเกินยอดประมาณการที่แนะนำ (soft cap 30%)
--   2) Admin/หัวหน้างานเห็นยอดสะสมประมาณการเดียวกันตอนพิจารณาอนุมัติ (ไม่ใช่แค่พนักงานเห็นเอง)
--   3) รองรับ salary_type = 'hourly' เพิ่มเติม (เดิมรองรับแค่ monthly/daily)
--
-- บริบท: refactor fn_get_advance_payment_estimate_summary() เดิมให้แยก logic การคำนวณออกมาเป็น
-- helper กลาง fn_calc_advance_estimate(emp_id, company_id) เพื่อใช้ซ้ำได้ทั้งจากมุมมองพนักงาน
-- เอง (self-service, ผ่าน auth.uid()) และจากมุมมอง admin/payroll/supervisor ที่ต้องดูของพนักงาน
-- คนอื่น (ต้องเช็คสิทธิ์แยกต่างหาก - reuse pattern เดียวกับ employee_shift_assignments RLS:
-- admin/payroll เห็นทั้งบริษัท, supervisor เห็นเฉพาะพนักงานที่ผูกไซต์ที่ตนดูแล)
--
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP FUNCTION/TRIGGER IF EXISTS ก่อนสร้างใหม่เสมอ
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

-- =====================================================
-- PART 1: Helper กลาง fn_calc_advance_estimate(p_emp_id, p_company_id)
-- ย้าย logic คำนวณทั้งหมดมาไว้ที่นี่ (ไม่เช็คสิทธิ์ในนี้ - ผู้เรียกต้องเช็คสิทธิ์เอง)
-- เพิ่มรองรับ salary_type = 'hourly' (ใช้ total_hours - ot_hours รวม เป็นชั่วโมงปกติ)
-- =====================================================

BEGIN;

DROP FUNCTION IF EXISTS public.fn_get_advance_payment_estimate_summary_for_employee(text);
DROP FUNCTION IF EXISTS public.fn_get_advance_payment_estimate_summary();
DROP FUNCTION IF EXISTS public.fn_calc_advance_estimate(text, text);

CREATE OR REPLACE FUNCTION public.fn_calc_advance_estimate(p_emp_id text, p_company_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
  v_total_hours_sum numeric := 0;
  v_regular_hours numeric := 0;
  v_base_earned numeric := 0;
  v_ot_earned numeric := 0;
  v_total_estimated numeric := 0;
  v_already_requested numeric := 0;
  v_cap_percent numeric := 0.30; -- 30% ตามที่ user เลือกใน 22_advance_payment_estimate_summary.sql
  v_available numeric := 0;
BEGIN
  SELECT * INTO v_emp FROM public.employees e WHERE e.emp_id = p_emp_id AND e.company_id = p_company_id LIMIT 1;
  IF v_emp.id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_employee');
  END IF;

  SELECT COUNT(DISTINCT al.work_date) INTO v_worked_days
  FROM public.attendance_logs al
  WHERE al.emp_id = p_emp_id
    AND al.work_date BETWEEN v_period_start AND v_period_end
    AND al.status = 'present';

  SELECT COUNT(*) INTO v_late_count
  FROM public.attendance_logs al
  WHERE al.emp_id = p_emp_id
    AND al.work_date BETWEEN v_period_start AND v_period_end
    AND al.is_late IS TRUE;

  SELECT COALESCE(SUM(lr.total_days), 0) INTO v_leave_days
  FROM public.leave_requests lr
  WHERE lr.employee_id = v_emp.id
    AND lr.status = 'approved'
    AND lr.start_date <= v_period_end
    AND lr.end_date >= v_period_start;

  SELECT
    COALESCE(SUM(aod.ot_hours) FILTER (WHERE aod.ot_type = 'ot15'), 0),
    COALESCE(SUM(aod.ot_hours) FILTER (WHERE aod.ot_type = 'ot2'), 0),
    COALESCE(SUM(aod.ot_hours) FILTER (WHERE aod.ot_type = 'ot3'), 0)
  INTO v_ot15_hours, v_ot2_hours, v_ot3_hours
  FROM public.attendance_ot_details aod
  JOIN public.attendance_logs al ON al.id = aod.attendance_log_id
  WHERE al.emp_id = p_emp_id
    AND al.work_date BETWEEN v_period_start AND v_period_end;

  SELECT COALESCE(SUM(al.total_hours), 0) INTO v_total_hours_sum
  FROM public.attendance_logs al
  WHERE al.emp_id = p_emp_id
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
  ELSIF v_emp.salary_type = 'hourly' AND v_emp.hourly_rate IS NOT NULL THEN
    v_hourly_rate := v_emp.hourly_rate;
    v_has_salary_config := true;
    -- total_hours ใน attendance_logs รวม OT อยู่ด้วย (attendance_ot_details เป็นแหล่งความจริง
    -- ของ OT breakdown ตามที่ระบุใน 01_payroll_migration_v2.sql) - หักออกก่อนคูณเรทปกติ
    v_regular_hours := GREATEST(0, v_total_hours_sum - (v_ot15_hours + v_ot2_hours + v_ot3_hours));
    v_base_earned := v_regular_hours * v_hourly_rate;
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

  SELECT COALESCE(SUM(ap.amount), 0) INTO v_already_requested
  FROM public.advance_payments ap
  WHERE ap.emp_id = p_emp_id
    AND ap.status IN ('pending', 'approved')
    AND ap.created_at >= v_period_start;

  v_available := GREATEST(0, ROUND(v_total_estimated * v_cap_percent - v_already_requested, 2));

  RETURN jsonb_build_object(
    'emp_id', p_emp_id,
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

-- Self-service wrapper (พนักงานดูของตัวเองผ่าน auth.uid() - เหมือนเดิมทุกประการ)
CREATE OR REPLACE FUNCTION public.fn_get_advance_payment_estimate_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_up public.user_profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_up FROM public.user_profiles up WHERE up.auth_uid = auth.uid() LIMIT 1;
  IF v_up.id IS NULL OR v_up.emp_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_profile');
  END IF;
  RETURN public.fn_calc_advance_estimate(v_up.emp_id, v_up.company_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_advance_payment_estimate_summary() TO authenticated;

-- Admin/payroll/supervisor wrapper: ดูยอดประมาณการของพนักงานคนอื่นตอนพิจารณาอนุมัติคำขอเบิก
-- admin/payroll เห็นได้ทุกคนในบริษัทตนเอง, supervisor เห็นได้เฉพาะพนักงานที่ผูกไซต์ที่ตนดูแล
-- (pattern เดียวกับ employee_shift_assignments_select ใน 14_employee_shift_assignments.sql)
CREATE OR REPLACE FUNCTION public.fn_get_advance_payment_estimate_summary_for_employee(p_emp_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text := public.get_user_role();
  v_caller_company text := public.get_user_company();
  v_target public.employees%ROWTYPE;
  v_allowed boolean := false;
BEGIN
  SELECT * INTO v_target FROM public.employees e WHERE e.emp_id = p_emp_id LIMIT 1;
  IF v_target.id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_employee');
  END IF;

  IF v_target.company_id IS DISTINCT FROM v_caller_company THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  IF v_caller_role IN ('admin', 'payroll') THEN
    v_allowed := true;
  ELSIF v_caller_role = 'supervisor' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.employee_id = v_target.id
      AND up.primary_client_id IN (
        SELECT client_id FROM public.supervisor_client_assignments WHERE user_profile_id = public.get_user_profile_id()
      )
    ) INTO v_allowed;
  END IF;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  RETURN public.fn_calc_advance_estimate(p_emp_id, v_caller_company);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_advance_payment_estimate_summary_for_employee(text) TO authenticated;

COMMIT;

-- =====================================================
-- PART 2: แจ้งเตือน admin/payroll เมื่อคำขอเบิกเกินยอดประมาณการที่แนะนำ (soft cap)
-- ไม่บล็อกการส่งคำขอ (ยังส่งได้เสมอ - admin เป็นคนตัดสินใจสุดท้าย) แค่ flag ไว้ + แจ้งเตือน
-- =====================================================

BEGIN;

ALTER TABLE public.advance_payments
  ADD COLUMN IF NOT EXISTS exceeds_estimated_cap boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.fn_advance_payment_flag_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary jsonb;
  v_available numeric;
BEGIN
  v_summary := public.fn_calc_advance_estimate(NEW.emp_id, NEW.company_id);
  IF v_summary ? 'available_to_request' THEN
    v_available := (v_summary->>'available_to_request')::numeric;
    -- available_to_request คำนวณจากยอดที่ pending/approved อยู่แล้วก่อนแถวนี้ถูก insert
    -- (แถวนี้ยังไม่ถูกนับเพราะ trigger เป็น BEFORE INSERT) จึงเทียบ NEW.amount กับ available ตรงๆ ได้
    NEW.exceeds_estimated_cap := (NEW.amount > v_available);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advance_payment_flag_cap ON public.advance_payments;
CREATE TRIGGER trg_advance_payment_flag_cap
BEFORE INSERT ON public.advance_payments
FOR EACH ROW
EXECUTE FUNCTION public.fn_advance_payment_flag_cap();

CREATE OR REPLACE FUNCTION public.fn_notify_advance_payment_cap_exceeded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_full_name text;
BEGIN
  IF NEW.exceeds_estimated_cap IS TRUE THEN
    SELECT full_name INTO v_full_name FROM public.employees WHERE emp_id = NEW.emp_id LIMIT 1;
    FOR v_admin_id IN SELECT * FROM public.fn_get_admin_payroll_profile_ids(NEW.company_id) LOOP
      INSERT INTO public.notifications (company_id, recipient_user_profile_id, category, title, body, source_table, source_id)
      VALUES (NEW.company_id, v_admin_id, 'advance_payment_exceeds_cap',
        'คำขอเบิกเงินล่วงหน้าเกินยอดประมาณการที่แนะนำ',
        format('พนักงาน %s (%s) ขอเบิก %s บาท ซึ่งเกินยอดประมาณการที่แนะนำ (30%% ของค่าแรงสะสมโดยประมาณ) - กรุณาตรวจสอบก่อนอนุมัติ', COALESCE(v_full_name, NEW.emp_id), NEW.emp_id, NEW.amount),
        'advance_payments', NEW.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_advance_payment_cap_exceeded ON public.advance_payments;
CREATE TRIGGER trg_notify_advance_payment_cap_exceeded
AFTER INSERT ON public.advance_payments
FOR EACH ROW
EXECUTE FUNCTION public.fn_notify_advance_payment_cap_exceeded();

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('fn_calc_advance_estimate','fn_get_advance_payment_estimate_summary','fn_get_advance_payment_estimate_summary_for_employee',
--    'fn_advance_payment_flag_cap','fn_notify_advance_payment_cap_exceeded');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'advance_payments' AND column_name = 'exceeds_estimated_cap';
