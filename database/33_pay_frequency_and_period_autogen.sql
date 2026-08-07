-- =====================================================
-- database/33_pay_frequency_and_period_autogen.sql
-- Milestone 5 Phase 2: สร้างงวดเงินเดือนอัตโนมัติตามกฎการจ่ายจริงของ KC Clean Trade
-- (ยืนยันกับ user แล้วผ่าน ask_user ใน session นี้):
--   - รายเดือน: งวด 16 (เดือนก่อน) ถึง 15 (เดือนนี้) จ่ายวันที่ 25
--   - รายสัปดาห์ (กึ่งเดือน/semimonthly): งวด 1-15 จ่าย 16 / งวด 16-สิ้นเดือน จ่าย 1 (เดือนถัดไป)
--   - รายวัน: งวด = วันเดียว จ่ายไม่เกิน 24 ชม. (รันทุกวัน) - ยังต้องกดอนุมัติ 1 ครั้งก่อนจ่ายเสมอ
--     (ไม่ auto-approve แม้จะเร็ว - ยืนยันแล้วว่าต้องการให้มีคนเช็คก่อนจ่ายจริงเสมอ)
--
-- บริบทสำคัญ: พนักงาน salary_type='daily' คนเดียวกันอาจจ่ายแบบ 'daily' (ทุกวัน) หรือ 'semimonthly'
-- (กึ่งเดือน) แล้วแต่คน - จึงต้องมีฟิลด์ pay_frequency แยกจาก salary_type (ซึ่งเป็นแค่ฐานอัตราค่าจ้าง
-- ไม่ใช่รอบการจ่าย) พนักงาน salary_type='monthly' ถือว่า pay_frequency='monthly' เสมอ (ไม่ต้องเลือก)
--
-- fn_run_payroll_period (32_payroll_engine_freelance_and_shift.sql) จะถูกอัปเดตในไฟล์ถัดไป
-- (34_payroll_engine_pay_frequency_filter.sql) ให้กรองพนักงานตาม pay_frequency ให้ตรงกับ
-- period_type ของงวดที่กำลังรัน (กันไม่ให้พนักงานรายเดือนถูกคำนวณเงินเต็มเดือนซ้ำในงวดรายวัน)
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

-- =====================================================
-- PART 1: employees.pay_frequency
-- =====================================================

BEGIN;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS pay_frequency text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_pay_frequency_check') THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_pay_frequency_check CHECK (pay_frequency IS NULL OR pay_frequency IN ('daily', 'semimonthly', 'monthly'));
  END IF;
END $$;

COMMENT ON COLUMN public.employees.pay_frequency IS
  'รอบการจ่ายเงินจริง (ต่างจาก salary_type ซึ่งเป็นแค่ฐานอัตราค่าจ้าง): daily = จ่ายทุกวันไม่เกิน 24 ชม., semimonthly = จ่าย 2 ครั้ง/เดือน (1-15 จ่าย16, 16-สิ้นเดือน จ่าย1), monthly = จ่ายเดือนละครั้ง (15->15 จ่าย 25) - salary_type=monthly ถือเป็น monthly เสมอ, salary_type=daily ต้องเลือกเองว่า daily หรือ semimonthly ไม่เดา';

COMMIT;

-- =====================================================
-- PART 2: payroll_periods.period_type รองรับค่า 'semimonthly' เพิ่ม (ของเดิมมี monthly/daily)
-- ตาราง period_type เป็น text ธรรมดาไม่มี CHECK constraint อยู่แล้ว - ไม่ต้องแก้ schema
-- แค่เพิ่มฟังก์ชันสร้างงวดอัตโนมัติ
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_generate_next_payroll_period(p_company_id text, p_period_type text, p_created_by uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_end date;
  v_new_start date;
  v_new_end date;
  v_pay_date date;
  v_period_id uuid;
  v_is_first_half boolean;
BEGIN
  IF p_period_type NOT IN ('monthly', 'semimonthly', 'daily') THEN
    RAISE EXCEPTION 'period_type ต้องเป็น monthly, semimonthly หรือ daily เท่านั้น (ได้รับ: %)', p_period_type;
  END IF;

  SELECT MAX(period_end) INTO v_last_end
  FROM public.payroll_periods
  WHERE company_id = p_company_id AND period_type = p_period_type;

  IF p_period_type = 'monthly' THEN
    -- งวด 16(เดือนก่อน) -> 15(เดือนนี้) จ่าย 25
    IF v_last_end IS NULL THEN
      IF EXTRACT(DAY FROM CURRENT_DATE) >= 15 THEN
        v_new_end := (date_trunc('month', CURRENT_DATE)::date + interval '14 days')::date; -- 15 เดือนนี้
      ELSE
        v_new_end := (date_trunc('month', CURRENT_DATE)::date - interval '1 month' + interval '14 days')::date; -- 15 เดือนก่อน
      END IF;
    ELSE
      v_new_end := (v_last_end + interval '1 month')::date; -- +1 เดือนจากวันที่ 15 ยังคงเป็น 15
    END IF;
    v_new_start := (v_new_end - interval '1 month' + interval '1 day')::date; -- วันที่ 16 ของเดือนก่อน v_new_end
    v_pay_date := (v_new_end + interval '10 days')::date; -- 15+10 = 25 เดือนเดียวกัน

  ELSIF p_period_type = 'semimonthly' THEN
    IF v_last_end IS NULL THEN
      IF EXTRACT(DAY FROM CURRENT_DATE) <= 15 THEN
        -- อยู่ช่วง 1-15 เดือนนี้ (ยังไม่ปิดงวด) -> งวดล่าสุดที่ปิดแล้วคืองวด 16-สิ้นเดือนก่อนหน้า
        v_new_end := (date_trunc('month', CURRENT_DATE)::date - interval '1 day')::date;
        v_new_start := (date_trunc('month', v_new_end)::date + interval '15 days')::date;
        v_pay_date := date_trunc('month', CURRENT_DATE)::date;
      ELSE
        -- อยู่ช่วง 16-สิ้นเดือนนี้ (ยังไม่ปิดงวด) -> งวดล่าสุดที่ปิดแล้วคืองวด 1-15 เดือนนี้
        v_new_start := date_trunc('month', CURRENT_DATE)::date;
        v_new_end := (v_new_start + interval '14 days')::date;
        v_pay_date := (v_new_end + interval '1 day')::date;
      END IF;
    ELSE
      v_is_first_half := (EXTRACT(DAY FROM v_last_end) = 15);
      IF v_is_first_half THEN
        -- v_last_end คืองวด 1-15 -> ถัดไปคือ 16-สิ้นเดือนเดียวกัน จ่าย 1 เดือนถัดไป
        v_new_start := v_last_end + 1;
        v_new_end := (date_trunc('month', v_last_end) + interval '1 month' - interval '1 day')::date;
        v_pay_date := (date_trunc('month', v_last_end) + interval '1 month')::date;
      ELSE
        -- v_last_end คือสิ้นเดือน -> ถัดไปคือ 1-15 เดือนถัดไป จ่าย 16 เดือนถัดไป
        v_new_start := v_last_end + 1;
        v_new_end := (v_new_start + interval '14 days')::date;
        v_pay_date := (v_new_end + interval '1 day')::date;
      END IF;
    END IF;

  ELSE -- daily
    v_new_start := COALESCE(v_last_end + 1, CURRENT_DATE);
    v_new_end := v_new_start;
    v_pay_date := v_new_start + 1; -- จ่ายไม่เกิน 24 ชม. = วันถัดไป
  END IF;

  -- Idempotent: ถ้ามีงวดช่วงวันเดียวกันอยู่แล้วสำหรับ period_type นี้ ให้คืน id เดิม ไม่สร้างซ้ำ
  SELECT id INTO v_period_id FROM public.payroll_periods
  WHERE company_id = p_company_id AND period_type = p_period_type
    AND period_start = v_new_start AND period_end = v_new_end;

  IF v_period_id IS NULL THEN
    INSERT INTO public.payroll_periods (company_id, period_type, period_start, period_end, pay_date, status, created_by)
    VALUES (p_company_id, p_period_type, v_new_start, v_new_end, v_pay_date, 'open', p_created_by)
    RETURNING id INTO v_period_id;
  END IF;

  RETURN v_period_id;
END;
$$;

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT public.fn_generate_next_payroll_period('comp_kc_clean', 'monthly', NULL);
-- SELECT public.fn_generate_next_payroll_period('comp_kc_clean', 'semimonthly', NULL);
-- SELECT public.fn_generate_next_payroll_period('comp_kc_clean', 'daily', NULL);
-- SELECT * FROM public.payroll_periods ORDER BY created_at DESC LIMIT 5;
