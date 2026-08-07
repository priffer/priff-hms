-- =====================================================
-- database/25_attendance_ot_materialize.sql
-- Payroll Engine Milestone 4: กระบวนการ materialize attendance_ot_details จาก
-- ot_requests (approved) + attendance_logs (ชั่วโมงทำงานจริง) + company_holidays/client_holidays
--
-- บริบท (ตัดสินใจร่วมกับ user ผ่าน ask_user ใน session นี้ - เลือกทางเลือก (a)):
--   attendance_ot_details ไม่เคยถูกเติมข้อมูลอัตโนมัติเลยมาก่อน (มีแค่ใน seed data มือ)
--   สร้างกระบวนการนี้เพื่อแปลง "ชั่วโมงทำงานจริงที่เกินเวลาปกติ" + "คำขอโอทีที่อนุมัติแล้ว"
--   ให้กลายเป็นแถว attendance_ot_details (ot15/ot2/ot3) พร้อม audit trail แยกต่างหาก
--   (ot_materialization_log) เพื่อให้ตรวจสอบย้อนหลังได้ว่าทำไมพนักงานคนนี้ได้ OT ประเภทไหน
--   กี่ชั่วโมง ในวันไหน
--
-- กฎสำคัญที่ยึดตาม docs/payroll-architecture.md §4.2 และ §4.7 (ห้ามแก้โดยไม่ปรึกษา user):
--   1) OT ที่จ่ายจริง = MIN(ชั่วโมงทำงานเกินจริงจาก attendance_logs, ชั่วโมงที่ได้รับอนุมัติจาก
--      ot_requests สำหรับวันนั้น) - ถ้าไม่มีคำขอโอทีที่อนุมัติเลยสำหรับวันนั้น = ไม่มี OT จ่าย
--      (ป้องกันจ่าย OT ที่ไม่ผ่านการอนุมัติล่วงหน้าตาม flow ที่ออกแบบไว้ใน 16_ot_requests.sql)
--   2) ประเภท OT พิจารณาจาก "ระดับความสำคัญ" ไม่บวกซ้อนกัน: วันนักขัตฤกษ์ (company_holidays/
--      client_holidays) > วันหยุดประจำสัปดาห์ (employee_shift_assignments.weekly_rest_day) >
--      วันทำงานปกติ กล่าวคือถ้าวันนั้นเป็นทั้งวันหยุดประจำสัปดาห์และวันนักขัตฤกษ์ ให้ใช้ OT3
--      (อัตราสูงสุด) ไม่ใช่บวกทั้งสองเรท (ยังไม่มีข้อกำหนดชัดเจนเรื่องการซ้อนอัตราในเอกสาร -
--      ใช้แนวทางระมัดระวัง/อนุรักษ์นิยมไปก่อน ควรทบทวนกับฝ่ายกฎหมาย/บัญชีจริงภายหลัง)
--   3) client_holidays เป็น override เฉพาะไซต์ - ถ้าไม่มีแถวสำหรับวันที่นั้นที่ไซต์นั้น
--      ให้ fallback ไปเช็ค company_holidays (ตามที่ระบุไว้ใน 08_announcements_holidays.sql)
--   4) ถ้า weekly_rest_day เป็น NULL (ยังไม่ได้ตั้งค่า) - ไม่เดาว่าวันไหนเป็นวันหยุด ถือเป็น
--      วันทำงานปกติ (OT15 เท่านั้น) และบันทึกหมายเหตุ 'needs_rest_day_config' ไว้ใน description
--      ของ attendance_ot_details เพื่อให้ admin ตามไปตั้งค่า weekly_rest_day เพิ่มทีหลัง
--   5) ot_amount ในตารางนี้ตั้งเป็น 0 (placeholder) เสมอ - Payroll Engine (27_payroll_engine.sql)
--      เป็นผู้คำนวณค่าแรง OT จริงตอนรัน payroll (ต้องใช้ employees.hourly_rate ที่อาจเปลี่ยนแปลง
--      ได้ตามช่วงเวลา ไม่ควร freeze ไว้ตอน materialize) - ตาม pattern ที่ยืนยันไว้แล้วใน
--      22_advance_payment_estimate_summary.sql
--
-- กระบวนการ (idempotent - เรียกซ้ำได้ปลอดภัย, ล้างผลลัพธ์เก่าของ attendance_log_id นั้นก่อนเสมอ):
--   fn_materialize_attendance_ot(p_attendance_log_id uuid)
--   ถูกเรียกอัตโนมัติจาก 2 trigger:
--     - AFTER UPDATE ON ot_requests (เมื่อ status เปลี่ยนเป็น 'approved')
--     - AFTER INSERT OR UPDATE ON attendance_logs (เมื่อมี attendance log ที่มีคำขอ OT อนุมัติแล้ว
--       ของวันเดียวกันอยู่แล้ว - เผื่อกรณี attendance บันทึกทีหลัง หรือแก้ไขชั่วโมงทำงาน)
--
-- Idempotent: CREATE TABLE/FUNCTION IF NOT EXISTS หรือ OR REPLACE, DROP TRIGGER/POLICY IF EXISTS
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

-- =====================================================
-- PART 1: ot_materialization_log - audit trail แยกต่างหากจาก attendance_audit_logs
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ot_materialization_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_log_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  company_id text NOT NULL,
  work_date date NOT NULL,
  ot_request_ids jsonb, -- array ของ ot_requests.id ที่ถูกใช้อ้างอิงตอน materialize รอบนี้
  classification text NOT NULL, -- 'public_holiday' | 'weekly_rest_day' | 'normal_workday'
  raw_worked_ot_hours numeric NOT NULL DEFAULT 0,   -- ชั่วโมงเกินเวลาปกติที่ทำงานจริง (ก่อน cap)
  approved_ot_hours numeric NOT NULL DEFAULT 0,     -- ชั่วโมงที่อนุมัติรวมของวันนั้น
  final_ot_hours numeric NOT NULL DEFAULT 0,        -- MIN(raw, approved) ที่นำไปบันทึกจริง
  needs_rest_day_config boolean NOT NULL DEFAULT false,
  previous_details jsonb, -- snapshot ของ attendance_ot_details แถวเก่าก่อนล้าง (ถ้ามี)
  new_details jsonb,      -- snapshot ของแถวใหม่ที่ insert
  materialized_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_ot_matlog_attendance ON public.ot_materialization_log (attendance_log_id);
CREATE INDEX IF NOT EXISTS idx_ot_matlog_employee ON public.ot_materialization_log (employee_id);
CREATE INDEX IF NOT EXISTS idx_ot_matlog_company ON public.ot_materialization_log (company_id);

COMMIT;

BEGIN;

ALTER TABLE public.ot_materialization_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ot_matlog_select ON public.ot_materialization_log;
CREATE POLICY ot_matlog_select ON public.ot_materialization_log
  FOR SELECT
  USING (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
    OR (public.get_user_role() = 'employee' AND employee_id = (SELECT employee_id FROM public.user_profiles WHERE auth_uid = auth.uid()))
  );

-- INSERT/UPDATE ทำผ่าน SECURITY DEFINER function เท่านั้น (fn_materialize_attendance_ot ด้านล่าง)
-- ไม่เปิด policy ให้ client เขียนตรงเข้ามาในตารางนี้

COMMIT;

-- =====================================================
-- PART 2: fn_materialize_attendance_ot(p_attendance_log_id uuid)
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_materialize_attendance_ot(p_attendance_log_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log record;
  v_emp record;
  v_shift record;
  v_is_holiday boolean := false;
  v_is_rest_day boolean := false;
  v_needs_rest_day_config boolean := false;
  v_classification text;
  v_standard_hours numeric;
  v_raw_ot_hours numeric := 0;
  v_approved_ot_hours numeric := 0;
  v_final_ot_hours numeric := 0;
  v_ot_type text;
  v_ot_rate_multiplier numeric;
  v_ot_request_ids jsonb;
  v_previous_details jsonb;
  v_new_details jsonb;
  v_description text;
BEGIN
  SELECT * INTO v_log FROM public.attendance_logs WHERE id = p_attendance_log_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_log.employee_id IS NULL OR v_log.total_hours IS NULL THEN
    RETURN; -- ไม่มี employee_id ผูกไว้ หรือยังไม่มีชั่วโมงทำงานจริง - ยังไม่พร้อม materialize
  END IF;

  SELECT * INTO v_emp FROM public.employees WHERE id = v_log.employee_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- หาชั่วโมงมาตรฐาน ณ วันที่นั้น: ใช้กะที่มีผลอยู่ก่อน ถ้าไม่มีใช้ employees.standard_working_hours แล้ว fallback 8
  SELECT * INTO v_shift
  FROM public.employee_shift_assignments esa
  WHERE esa.employee_id = v_log.employee_id
    AND esa.effective_from <= v_log.work_date
    AND (esa.effective_to IS NULL OR esa.effective_to >= v_log.work_date)
  ORDER BY esa.effective_from DESC
  LIMIT 1;

  v_standard_hours := COALESCE(v_shift.standard_hours, v_emp.standard_working_hours, 8);

  -- ตรวจวันนักขัตฤกษ์: client_holidays ก่อน (override เฉพาะไซต์) ถ้าไม่มีแถว fallback company_holidays
  v_is_holiday := (
    (v_log.client_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.client_holidays ch WHERE ch.client_id = v_log.client_id AND ch.holiday_date = v_log.work_date
    ))
    OR EXISTS (
      SELECT 1 FROM public.company_holidays coh WHERE coh.company_id = v_emp.company_id AND coh.holiday_date = v_log.work_date
    )
  );

  -- ตรวจวันหยุดประจำสัปดาห์ (ถ้าตั้งค่าไว้เท่านั้น - NULL = ไม่เดา)
  IF v_shift.weekly_rest_day IS NOT NULL THEN
    v_is_rest_day := (EXTRACT(DOW FROM v_log.work_date)::integer = v_shift.weekly_rest_day);
  ELSE
    v_needs_rest_day_config := true;
  END IF;

  -- จัดประเภทตามลำดับความสำคัญ: holiday > rest_day > normal (ไม่ซ้อนอัตรา)
  IF v_is_holiday THEN
    v_classification := 'public_holiday';
    v_ot_type := 'ot3';
    v_ot_rate_multiplier := 3.0;
  ELSIF v_is_rest_day THEN
    v_classification := 'weekly_rest_day';
    v_ot_type := 'ot2';
    v_ot_rate_multiplier := 2.0;
  ELSE
    v_classification := 'normal_workday';
    v_ot_type := 'ot15';
    v_ot_rate_multiplier := 1.5;
  END IF;

  -- ชั่วโมงเกินเวลาปกติที่ทำงานจริง
  v_raw_ot_hours := GREATEST(v_log.total_hours - v_standard_hours, 0);

  -- ชั่วโมงที่ได้รับอนุมัติรวมของวันนั้น (จาก ot_requests สถานะ approved)
  SELECT COALESCE(SUM(r.requested_hours), 0), COALESCE(jsonb_agg(r.id), '[]'::jsonb)
  INTO v_approved_ot_hours, v_ot_request_ids
  FROM public.ot_requests r
  WHERE r.employee_id = v_log.employee_id
    AND r.work_date = v_log.work_date
    AND r.status = 'approved';

  -- OT ที่จ่ายจริง = MIN(ทำงานเกินจริง, อนุมัติแล้ว) - ไม่มีคำขออนุมัติ = ไม่มี OT จ่าย
  v_final_ot_hours := LEAST(v_raw_ot_hours, v_approved_ot_hours);

  -- Snapshot แถวเก่าก่อนล้าง (สำหรับ audit trail)
  SELECT COALESCE(jsonb_agg(to_jsonb(aod)), '[]'::jsonb) INTO v_previous_details
  FROM public.attendance_ot_details aod WHERE aod.attendance_log_id = p_attendance_log_id;

  -- ล้างผลลัพธ์เก่าของ attendance_log_id นี้ก่อนเสมอ (idempotent - เรียกซ้ำได้ปลอดภัย)
  DELETE FROM public.attendance_ot_details WHERE attendance_log_id = p_attendance_log_id;

  v_new_details := '[]'::jsonb;

  IF v_final_ot_hours > 0 THEN
    v_description := CASE WHEN v_needs_rest_day_config
      THEN 'auto-materialized (' || v_classification || '); needs_rest_day_config: ยังไม่ได้ตั้งค่าวันหยุดประจำสัปดาห์ของพนักงานคนนี้'
      ELSE 'auto-materialized (' || v_classification || ')'
    END;

    INSERT INTO public.attendance_ot_details
      (attendance_log_id, employee_id, company_id, ot_type, ot_hours, ot_rate_multiplier, ot_amount, updated_at)
    VALUES
      (p_attendance_log_id, v_log.employee_id, v_emp.company_id, v_ot_type, v_final_ot_hours, v_ot_rate_multiplier, 0, timezone('utc'::text, now()))
    RETURNING to_jsonb(attendance_ot_details.*) INTO v_new_details;

    v_new_details := jsonb_build_array(v_new_details);
  END IF;

  INSERT INTO public.ot_materialization_log
    (attendance_log_id, employee_id, company_id, work_date, ot_request_ids, classification,
     raw_worked_ot_hours, approved_ot_hours, final_ot_hours, needs_rest_day_config,
     previous_details, new_details)
  VALUES
    (p_attendance_log_id, v_log.employee_id, v_emp.company_id, v_log.work_date, v_ot_request_ids, v_classification,
     v_raw_ot_hours, v_approved_ot_hours, v_final_ot_hours, v_needs_rest_day_config,
     v_previous_details, v_new_details);

  -- fn_compute_iso_week_and_weekly_ot (01_payroll_migration_v2.sql) เป็น BEFORE trigger บน
  -- attendance_logs เอง ที่คำนวณ weekly_ot_hours/weekly_ot_flagged จาก SUM(attendance_ot_details)
  -- สดทุกครั้งที่มี UPDATE - เรียก UPDATE แบบ no-op (set ค่าเดิม) เพื่อบังคับให้ trigger เดิมนั้น
  -- คำนวณใหม่ให้ตรงกับผลลัพธ์ OT ล่าสุดที่เพิ่ง insert ไปข้างบน (ไม่เขียน logic คำนวณซ้ำเองที่นี่
  -- เพื่อรักษาความสอดคล้องกับสูตร weekly OT cap 36 ชม./สัปดาห์ตัวเดียวตาม docs §4.7)
  UPDATE public.attendance_logs SET work_date = work_date WHERE id = p_attendance_log_id;
END;
$$;

COMMIT;

-- =====================================================
-- PART 3: Triggers - materialize อัตโนมัติเมื่อ ot_requests อนุมัติ หรือ attendance_logs เปลี่ยนแปลง
-- =====================================================

BEGIN;

-- 3.1 เมื่อ ot_requests เปลี่ยนสถานะเป็น approved -> materialize attendance log ของวันเดียวกัน (ถ้ามี)
CREATE OR REPLACE FUNCTION public.fn_trg_ot_request_approved_materialize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance_log_id uuid;
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    SELECT id INTO v_attendance_log_id
    FROM public.attendance_logs
    WHERE employee_id = NEW.employee_id AND work_date = NEW.work_date
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_attendance_log_id IS NOT NULL THEN
      PERFORM public.fn_materialize_attendance_ot(v_attendance_log_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ot_request_approved_materialize ON public.ot_requests;
CREATE TRIGGER trg_ot_request_approved_materialize
AFTER INSERT OR UPDATE OF status ON public.ot_requests
FOR EACH ROW
EXECUTE FUNCTION public.fn_trg_ot_request_approved_materialize();

-- 3.2 เมื่อ attendance_logs ถูกสร้าง/แก้ไขชั่วโมงทำงาน -> materialize ถ้ามีคำขอ OT อนุมัติแล้วของวันนั้นอยู่แล้ว
CREATE OR REPLACE FUNCTION public.fn_trg_attendance_log_materialize_ot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_approved boolean;
BEGIN
  IF NEW.employee_id IS NULL OR NEW.total_hours IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.ot_requests r
    WHERE r.employee_id = NEW.employee_id AND r.work_date = NEW.work_date AND r.status = 'approved'
  ) INTO v_has_approved;

  IF v_has_approved THEN
    PERFORM public.fn_materialize_attendance_ot(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_log_materialize_ot ON public.attendance_logs;
CREATE TRIGGER trg_attendance_log_materialize_ot
AFTER INSERT OR UPDATE OF total_hours, check_in, check_out ON public.attendance_logs
FOR EACH ROW
EXECUTE FUNCTION public.fn_trg_attendance_log_materialize_ot();

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT * FROM public.ot_materialization_log ORDER BY materialized_at DESC LIMIT 20;
-- SELECT * FROM public.attendance_ot_details WHERE ot_amount = 0 ORDER BY created_at DESC LIMIT 20;
-- -- ทดสอบด้วยมือ: SELECT public.fn_materialize_attendance_ot('<attendance_log_id>');
