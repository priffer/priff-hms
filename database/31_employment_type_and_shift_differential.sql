-- =====================================================
-- database/31_employment_type_and_shift_differential.sql
-- Milestone 5 Phase 1: รองรับ "ประเภทการจ้างงาน" (พนักงานประจำ vs ฟรีแลนซ์/จ็อบพิเศษ) และ
-- ค่ากะดึก (night shift differential) — ตัดสินใจร่วมกับ user ผ่าน ask_user ใน session นี้
--
-- บริบท: user อธิบายว่าพนักงานที่จ่ายรายวัน/รายสัปดาห์ "คนเดียวกัน" อาจเป็นได้ทั้งพนักงานประจำ
-- (มีสัญญาจ้าง + ประกันสังคม) หรือฟรีแลนซ์/จ็อบพิเศษ (ไม่มีสัญญาจ้าง ไม่มีประกันสังคม) แล้วแต่คน
-- ต้องมีฟิลด์ให้แอดมินเลือกเอง ไม่ใช่เดาจาก salary_type
--
-- กฎที่ยืนยันแล้ว:
--   - พนักงานประจำ (employment_type='regular'): หักประกันสังคม 5% (ตามเดิม) + ภาษีตารางขั้นบันได (ตามเดิม)
--   - ฟรีแลนซ์ (employment_type='freelance'): ไม่หักประกันสังคมเลย + หัก ณ ที่จ่ายคงที่ 3%
--     (ตามมาตรา 3 เตรส ของกรมสรรพากร สำหรับค่าจ้างทำของ/บริการที่จ่ายให้บุคคลธรรมดาที่ไม่ใช่ลูกจ้าง)
--
-- ค่ากะดึก (night shift differential) - user ยืนยันว่าต้องการให้คำนวณเข้าเงินเดือนจริง แต่ยังไม่มี
-- อัตราที่แน่นอน ให้ช่วยเสนอตัวเลขเริ่มต้น: เสนอ +10% ของค่าแรง/วันฐาน สำหรับกะที่ข้ามเที่ยงคืน
-- (shift_end < shift_start ใน employee_shift_assignments - ตรงกับ comment เดิมในตารางว่า
-- "ถ้า shift_end < shift_start แปลว่ากะข้ามเที่ยงคืน (กะกลางคืน)") เก็บเป็น payroll_rates แถวใหม่
-- ปรับได้ทีหลังผ่าน Admin UI เหมือน OT/ประกันสังคม ไม่ต้องแก้โค้ดถ้าจะเปลี่ยนอัตรา
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION, NOT EXISTS guard ก่อน seed
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

-- =====================================================
-- PART 1: employees.employment_type
-- =====================================================

BEGIN;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS employment_type text NOT NULL DEFAULT 'regular';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_employment_type_check') THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_employment_type_check CHECK (employment_type IN ('regular', 'freelance'));
  END IF;
END $$;

COMMENT ON COLUMN public.employees.employment_type IS
  'regular = พนักงานประจำ (มีสัญญาจ้าง+ประกันสังคม, ภาษีตารางขั้นบันได) | freelance = ฟรีแลนซ์/จ็อบพิเศษ (ไม่มีประกันสังคม, หัก ณ ที่จ่ายคงที่ 3%) - แอดมินเลือกเองรายคน ไม่เดาจาก salary_type';

COMMIT;

-- =====================================================
-- PART 2: seed อัตราใหม่ใน payroll_rates (freelance WHT 3%, ค่ากะดึก +10%)
-- =====================================================

BEGIN;

INSERT INTO public.payroll_rates (company_id, rate_type, rate_value, rate_multiplier, social_security_max_cap, effective_from)
SELECT v.company_id, v.rate_type, v.rate_value, v.rate_multiplier, v.social_security_max_cap, v.effective_from
FROM (VALUES
  ('comp_kc_clean', 'freelance_withholding_tax', 0.03, NULL::numeric, 0::numeric, '2026-01-01'::date),
  ('comp_kc_clean', 'night_shift_differential', 0.10, NULL::numeric, 0::numeric, '2026-01-01'::date)
) AS v(company_id, rate_type, rate_value, rate_multiplier, social_security_max_cap, effective_from)
WHERE NOT EXISTS (
  SELECT 1 FROM public.payroll_rates pr
  WHERE pr.company_id = v.company_id AND pr.rate_type = v.rate_type AND pr.effective_from = v.effective_from
);

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'employment_type';
-- SELECT * FROM public.payroll_rates WHERE rate_type IN ('freelance_withholding_tax', 'night_shift_differential');
