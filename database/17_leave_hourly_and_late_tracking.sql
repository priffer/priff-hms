-- =====================================================
-- database/17_leave_hourly_and_late_tracking.sql
-- ESS Redesign (รอบ 7): 2 ฟีเจอร์ที่ user ชี้ประเด็นว่ายังขาดอยู่จริง
--
-- (A) ลาแบบรายชั่วโมง (เช่น ลา 3 ชม.) - ยืนยันกับ user แล้วว่า:
--   - รองรับได้ทุกประเภทลา ไม่จำกัดเฉพาะลากิจ/ลาป่วย (ยืดหยุ่นไว้ก่อน)
--   - แปลงชั่วโมงที่ลาเป็น "เศษส่วนของวัน" เทียบกับชั่วโมงมาตรฐานของกะที่คนนั้นทำงานอยู่
--     (employee_shift_assignments.standard_hours) เพื่อนำไปหักโควตาวันลาต่อได้ถูกต้อง
--     เช่น ลา 3 ชม. จากกะมาตรฐาน 8 ชม./วัน = 0.375 วัน - คำนวณฝั่ง DB ทั้งหมด (ไม่เชื่อ
--     ค่าที่ client ส่งมา ตาม pattern เดียวกับ fn_ot_request_precheck ใน 16_ot_requests.sql)
--   - ยังไม่แตะ Payroll Engine calculation logic จริง (ไฟล์นี้แค่เตรียมข้อมูล total_days ที่
--     ถูกต้องไว้ในตาราง leave_requests ให้ payroll engine ในอนาคตหักโควตา/คำนวณค่าแรงต่อได้
--     ไม่ได้เขียน logic คำนวณเงินเดือนใดๆ ในไฟล์นี้)
--
-- (B) ตรวจจับ "มาสาย" กี่นาที บน attendance_logs - ยืนยันกับ user แล้วว่า:
--   - เข้มงวด ไม่มี grace period (สายแม้ 1 นาทีก็นับว่าสาย) - เก็บเป็นตัวเลข late_minutes
--     ไว้เฉยๆ ไม่ตัดสินใจแทน payroll ว่าจะหักเงิน/เบี้ยขยันอย่างไร (นั่นเป็นงานของ Payroll Engine
--     ในอนาคต ไฟล์นี้แค่เตรียมข้อมูลดิบที่ถูกต้องไว้ให้)
--   - เทียบกับ employee_shift_assignments.shift_start ที่มีผลอยู่ ณ work_date นั้น (pattern
--     เดียวกับ (A)) - ถ้าไม่มีกะที่ผูกไว้ หรือเป็นกะกลางคืน (shift_end < shift_start ข้ามเที่ยงคืน)
--     จะไม่คำนวณให้ (late_minutes = NULL) เพราะเทียบเวลาข้ามวันแบบ time-only ไม่ได้แม่นยำพอ -
--     เป็นข้อจำกัดที่ทราบแล้ว ถ้าต้องการรองรับกะกลางคืนในอนาคตต้องออกแบบเพิ่ม
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP TRIGGER/FUNCTION IF EXISTS ก่อนสร้างใหม่เสมอ
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

-- =====================================================
-- PART A: ลาแบบรายชั่วโมง
-- =====================================================

BEGIN;

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS leave_unit text NOT NULL DEFAULT 'day', -- 'day' | 'hour'
  ADD COLUMN IF NOT EXISTS start_time time, -- ใช้เฉพาะ leave_unit='hour'
  ADD COLUMN IF NOT EXISTS end_time time,   -- ใช้เฉพาะ leave_unit='hour'
  ADD COLUMN IF NOT EXISTS total_hours numeric; -- จำนวนชั่วโมงดิบที่ขอ (ใช้เฉพาะ leave_unit='hour')

ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS leave_requests_unit_check;
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_unit_check
  CHECK (leave_unit IN ('day', 'hour'));

-- ลาราย ชม. ต้องเป็นวันเดียวกัน (start_date = end_date) และมี total_hours ระบุไว้เสมอ
ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS leave_requests_hourly_check;
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_hourly_check
  CHECK (
    leave_unit = 'day'
    OR (leave_unit = 'hour' AND start_date = end_date AND total_hours IS NOT NULL AND total_hours > 0 AND total_hours <= 24)
  );

COMMIT;

-- ฟังก์ชันช่วย: หา standard_hours ของกะที่มีผลอยู่ ณ วันที่ระบุ (ใช้ร่วมกับ PART B ด้วย)
-- fallback 8 ชม./วัน ถ้าพนักงานคนนั้นไม่มีกะที่ผูกไว้เลย (เช่น พนักงานออฟฟิศเก่าที่ยังไม่ได้ตั้งกะ)
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_get_standard_hours_for_date(p_employee_id uuid, p_date date)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT esa.standard_hours
      FROM public.employee_shift_assignments esa
      WHERE esa.employee_id = p_employee_id
        AND esa.effective_from <= p_date
        AND (esa.effective_to IS NULL OR esa.effective_to >= p_date)
      ORDER BY esa.effective_from DESC
      LIMIT 1
    ),
    8 -- fallback มาตรฐานถ้าไม่มีกะผูกไว้
  );
$$;

COMMIT;

BEGIN;

-- คำนวณ total_days อัตโนมัติสำหรับคำขอลาราย ชม. เทียบกับ standard_hours ของกะ ณ start_date
-- (ไม่แตะ total_days ของคำขอลาราย "วัน" ปกติ ยังคงพฤติกรรมเดิมที่ client คำนวณส่งมา)
CREATE OR REPLACE FUNCTION public.fn_leave_request_hourly_precheck()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_standard_hours numeric;
BEGIN
  IF NEW.leave_unit = 'hour' THEN
    v_standard_hours := public.fn_get_standard_hours_for_date(NEW.employee_id, NEW.start_date);
    NEW.total_days := ROUND(NEW.total_hours / v_standard_hours, 4);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leave_request_hourly_precheck ON public.leave_requests;
CREATE TRIGGER trg_leave_request_hourly_precheck
BEFORE INSERT OR UPDATE ON public.leave_requests
FOR EACH ROW
EXECUTE FUNCTION public.fn_leave_request_hourly_precheck();

COMMIT;

-- =====================================================
-- PART B: ตรวจจับมาสาย (late_minutes) บน attendance_logs
-- =====================================================

BEGIN;

ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS late_minutes integer, -- null = ไม่สามารถคำนวณได้ (ไม่มีกะผูกไว้ หรือเป็นกะกลางคืน)
  ADD COLUMN IF NOT EXISTS is_late boolean; -- snapshot true/false ตอนคำนวณ ไว้ query ง่ายกว่า late_minutes > 0

COMMIT;

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_attendance_compute_late_minutes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift record;
BEGIN
  IF NEW.check_in IS NULL OR NEW.employee_id IS NULL THEN
    NEW.late_minutes := NULL;
    NEW.is_late := NULL;
    RETURN NEW;
  END IF;

  SELECT esa.shift_start, esa.shift_end INTO v_shift
  FROM public.employee_shift_assignments esa
  WHERE esa.employee_id = NEW.employee_id
    AND esa.effective_from <= NEW.work_date
    AND (esa.effective_to IS NULL OR esa.effective_to >= NEW.work_date)
  ORDER BY esa.effective_from DESC
  LIMIT 1;

  -- ไม่มีกะผูกไว้ หรือเป็นกะกลางคืน (ข้ามเที่ยงคืน) - เทียบเวลาแบบ time-only ไม่แม่นยำพอ ข้ามไปก่อน
  IF v_shift IS NULL OR v_shift.shift_end < v_shift.shift_start THEN
    NEW.late_minutes := NULL;
    NEW.is_late := NULL;
    RETURN NEW;
  END IF;

  NEW.late_minutes := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NEW.check_in - v_shift.shift_start)) / 60)::integer);
  NEW.is_late := NEW.late_minutes > 0;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_compute_late_minutes ON public.attendance_logs;
CREATE TRIGGER trg_attendance_compute_late_minutes
BEFORE INSERT OR UPDATE ON public.attendance_logs
FOR EACH ROW
EXECUTE FUNCTION public.fn_attendance_compute_late_minutes();

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT proname FROM pg_proc WHERE proname IN ('fn_get_standard_hours_for_date','fn_leave_request_hourly_precheck','fn_attendance_compute_late_minutes');
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'leave_requests' AND column_name IN ('leave_unit','start_time','end_time','total_hours');
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name IN ('late_minutes','is_late');
