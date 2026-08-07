-- =====================================================
-- database/20_night_shift_late_minutes_fix.sql
-- ต่อยอด database/17_leave_hourly_and_late_tracking.sql (PART B): แก้ให้ fn_attendance_compute_late_minutes()
-- คำนวณมาสายสำหรับ "กะกลางคืน" (ข้ามเที่ยงคืน, shift_end < shift_start) ได้จริง
-- แทนที่จะข้ามไปเลย (late_minutes = NULL) เหมือนเดิม
--
-- ปัญหาเดิม: check_in เป็น column ประเภท time (ไม่มีวันที่) ถ้าเทียบตรงๆ กับ shift_start แบบ
-- "นาฬิกา" สำหรับกะที่ข้ามเที่ยงคืน (เช่น กะ 22:00-06:00) พนักงานที่มาสายมากจนเลยเที่ยงคืน
-- (เช่น เช็คอิน 00:30) จะได้ check_in (00:30) < shift_start (22:00) ตามนาฬิกา ทำให้คำนวณ
-- ผิดว่า "มาก่อนเวลา" ทั้งที่จริงๆ สายไปแล้วกว่า 2 ชั่วโมงครึ่ง
--
-- แก้ไข: เช็คว่า check_in อยู่ใน "ช่วงเช้ามืดหลังเที่ยงคืนของกะนั้น" หรือไม่ (check_in <= shift_end)
-- ถ้าใช่ ให้บวก 24 ชม. เข้าไปก่อนเทียบกับ shift_start (ถือว่าเป็นวันถัดไปแล้วจริงๆ)
-- ถ้า check_in > shift_end (เช่น เช็คอิน 21:50 หรือ 23:00 ซึ่งเป็นช่วงก่อนเที่ยงคืนของวันเดียวกัน)
-- ให้เทียบตรงๆ แบบเดิม (อาจเป็นมาก่อนเวลา หรือมาสายแต่ยังไม่ข้ามเที่ยงคืน)
--
-- Idempotent: CREATE OR REPLACE FUNCTION
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_attendance_compute_late_minutes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift record;
  v_diff_minutes numeric;
  v_is_night_shift boolean;
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

  -- ไม่มีกะผูกไว้เลย - ยังคงข้ามการคำนวณเหมือนเดิม (ไม่มีเวลามาตรฐานให้เทียบ)
  IF v_shift IS NULL THEN
    NEW.late_minutes := NULL;
    NEW.is_late := NULL;
    RETURN NEW;
  END IF;

  v_is_night_shift := v_shift.shift_end < v_shift.shift_start;

  IF v_is_night_shift AND NEW.check_in <= v_shift.shift_end THEN
    -- เช็คอินอยู่ในช่วงเช้ามืดหลังเที่ยงคืนของกะนี้ (เช่น กะ 22:00-06:00 เช็คอิน 00:30)
    -- ต้องบวก 24 ชม. ก่อนเทียบกับ shift_start เพราะข้ามวันไปแล้วจริงๆ
    v_diff_minutes := EXTRACT(EPOCH FROM (NEW.check_in - v_shift.shift_start)) / 60 + 1440;
  ELSE
    -- กะกลางวันปกติ หรือกะกลางคืนที่เช็คอินก่อนเที่ยงคืน (ยังไม่ข้ามวัน) - เทียบตรงๆ ได้เลย
    v_diff_minutes := EXTRACT(EPOCH FROM (NEW.check_in - v_shift.shift_start)) / 60;
  END IF;

  NEW.late_minutes := GREATEST(0, ROUND(v_diff_minutes))::integer;
  NEW.is_late := NEW.late_minutes > 0;

  RETURN NEW;
END;
$$;

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- ทดสอบกะกลางคืน 22:00-06:00 เช็คอิน 00:30 (สาย 2 ชม. 30 นาทีจากเที่ยงคืน+ครึ่งชม. หลัง shift_start)
-- คาดหวัง late_minutes = 150 (2 ชม. 30 นาที)
