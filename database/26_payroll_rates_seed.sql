-- =====================================================
-- database/26_payroll_rates_seed.sql
-- Payroll Engine Milestone 4: seed ค่าเริ่มต้นของ payroll_rates + ตารางภาษีหัก ณ ที่จ่าย (PIT) ปี 2026
--
-- บริบท (ตัดสินใจร่วมกับ user ผ่าน ask_user ใน session นี้):
--   - payroll_rates ว่างเปล่ามาตลอด ผู้ใช้เลือกให้ seed ค่าเริ่มต้นตามกฎหมายไปก่อนเลย (เร็วกว่า)
--     แล้วค่อยทำ Admin UI ให้แก้ไขได้ทีหลังในไฟล์ถัดไป (27_admin_payroll UI)
--   - ภาษีหัก ณ ที่จ่ายไม่มีตารางจริงในเอกสาร ผู้ใช้เลือกใช้ตาราง PIT จริงจากกรมสรรพากร
--     (อัตราก้าวหน้าปี 2026 - เหมือนที่ใช้บังคับอยู่ปัจจุบัน ไม่เปลี่ยนแปลงจากปีก่อนๆ):
--       0 - 150,000            ยกเว้นภาษี (0%)
--       150,001 - 300,000      5%
--       300,001 - 500,000      10%
--       500,001 - 750,000      15%
--       750,001 - 1,000,000    20%
--       1,000,001 - 2,000,000  25%
--       2,000,001 - 5,000,000  30%
--       5,000,001 ขึ้นไป        35%
--     พร้อมหักค่าใช้จ่าย 60,000 บาท/ปี + ค่าลดหย่อนส่วนตัว 60,000 บาท/ปี (ก่อนคำนวณตามตาราง)
--     คำนวณจริงอยู่ที่ Payroll Engine (27_payroll_engine.sql) - ไฟล์นี้แค่เก็บตาราง bracket
--
-- ค่า rate_value ที่ seed (อ้างอิง docs/payroll-architecture.md §4.2, §4.3, §4.6):
--   ot_15 = 1.5, ot_2 = 2.0, ot_3 = 3.0 (multiplier ของค่าแรง/ชม.)
--   social_security_employee = 0.05 (5%, cap 875 บาท/เดือน ตาม ม.33)
--   social_security_employer = 0.05 (5%, cap เดียวกัน - ยังไม่ได้ระบุอัตรานายจ้างต่างจากลูกจ้างในเอกสาร)
--   absence_per_day = ไม่ seed เป็นตัวเลขคงที่ เพราะควรคำนวณจาก daily_rate จริงของพนักงานแต่ละคน
--     (ที่แตกต่างกันตามฐานเงินเดือน) ในชั้น Payroll Engine โดยตรง แทนที่จะ fix เป็นค่าเดียวที่นี่
--     - ปล่อยว่างไว้ก่อน ถ้า admin ต้องการ override เป็นค่าคงที่ทีหลังสามารถเพิ่มแถวผ่าน Admin UI ได้
--
-- Idempotent: ใช้ NOT EXISTS guard ก่อน insert (ป้องกัน rate ซ้ำช่วง effective_from เดียวกัน)
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

-- =====================================================
-- PART 1: Seed payroll_rates (company_id = 'comp_kc_clean', effective_from = 2026-01-01)
-- =====================================================

BEGIN;

INSERT INTO public.payroll_rates (company_id, rate_type, rate_value, rate_multiplier, social_security_max_cap, effective_from)
SELECT v.company_id, v.rate_type, v.rate_value, v.rate_multiplier, v.social_security_max_cap, v.effective_from
FROM (VALUES
  ('comp_kc_clean', 'ot_15', 1.5, 1.5, 875::numeric, '2026-01-01'::date),
  ('comp_kc_clean', 'ot_2', 2.0, 2.0, 875::numeric, '2026-01-01'::date),
  ('comp_kc_clean', 'ot_3', 3.0, 3.0, 875::numeric, '2026-01-01'::date),
  ('comp_kc_clean', 'social_security_employee', 0.05, NULL, 875::numeric, '2026-01-01'::date),
  ('comp_kc_clean', 'social_security_employer', 0.05, NULL, 875::numeric, '2026-01-01'::date)
) AS v(company_id, rate_type, rate_value, rate_multiplier, social_security_max_cap, effective_from)
WHERE NOT EXISTS (
  SELECT 1 FROM public.payroll_rates pr
  WHERE pr.company_id = v.company_id AND pr.rate_type = v.rate_type AND pr.effective_from = v.effective_from
);

COMMIT;

-- =====================================================
-- PART 2: payroll_tax_brackets - ตารางภาษีเงินได้บุคคลธรรมดา (PIT) แบบขั้นบันได ปี 2026
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.payroll_tax_brackets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'comp_kc_clean',
  tax_year integer NOT NULL,
  bracket_order integer NOT NULL, -- ลำดับขั้น (1 = ต่ำสุด)
  income_from numeric NOT NULL,   -- รายได้สุทธิ (หลังหักค่าใช้จ่าย+ลดหย่อน) ขั้นต่ำของ bracket นี้ (รวม)
  income_to numeric,              -- ขั้นสูงของ bracket นี้ (NULL = ไม่มีเพดานบน)
  tax_rate numeric NOT NULL,      -- อัตราภาษีของ bracket นี้ (เช่น 0.05 = 5%)
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT payroll_tax_brackets_unique UNIQUE (company_id, tax_year, bracket_order)
);
CREATE INDEX IF NOT EXISTS idx_tax_brackets_company_year ON public.payroll_tax_brackets (company_id, tax_year);

INSERT INTO public.payroll_tax_brackets (company_id, tax_year, bracket_order, income_from, income_to, tax_rate)
SELECT v.company_id, v.tax_year, v.bracket_order, v.income_from, v.income_to, v.tax_rate
FROM (VALUES
  ('comp_kc_clean', 2026, 1, 0::numeric,          150000::numeric,  0.00),
  ('comp_kc_clean', 2026, 2, 150000::numeric,     300000::numeric,  0.05),
  ('comp_kc_clean', 2026, 3, 300000::numeric,     500000::numeric,  0.10),
  ('comp_kc_clean', 2026, 4, 500000::numeric,     750000::numeric,  0.15),
  ('comp_kc_clean', 2026, 5, 750000::numeric,     1000000::numeric, 0.20),
  ('comp_kc_clean', 2026, 6, 1000000::numeric,    2000000::numeric, 0.25),
  ('comp_kc_clean', 2026, 7, 2000000::numeric,    5000000::numeric, 0.30),
  ('comp_kc_clean', 2026, 8, 5000000::numeric,    NULL,             0.35)
) AS v(company_id, tax_year, bracket_order, income_from, income_to, tax_rate)
WHERE NOT EXISTS (
  SELECT 1 FROM public.payroll_tax_brackets tb
  WHERE tb.company_id = v.company_id AND tb.tax_year = v.tax_year AND tb.bracket_order = v.bracket_order
);

-- ค่าลดหย่อนมาตรฐานต่อปี (หักก่อนคำนวณตามตาราง bracket ด้านบน) - เก็บแยกเป็น setting ต่อบริษัท/ปี
-- เพื่อให้ admin ปรับได้ในอนาคตถ้ากฎหมายเปลี่ยน โดยไม่ต้องแก้โค้ด Payroll Engine
CREATE TABLE IF NOT EXISTS public.payroll_tax_allowance_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'comp_kc_clean',
  tax_year integer NOT NULL,
  standard_expense_deduction numeric NOT NULL DEFAULT 60000, -- ค่าใช้จ่าย 50% ของเงินได้ แต่ไม่เกิน 100,000 ตามกฎหมายจริง (ใช้ 60,000 เป็นค่าประมาณอนุรักษ์นิยมตามที่ user ยืนยัน)
  personal_allowance numeric NOT NULL DEFAULT 60000,          -- ค่าลดหย่อนส่วนตัว
  child_allowance_per_child numeric NOT NULL DEFAULT 30000,   -- ลดหย่อนบุตรต่อคน (ตามกฎหมายทั่วไป)
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT payroll_tax_allowance_defaults_unique UNIQUE (company_id, tax_year)
);

INSERT INTO public.payroll_tax_allowance_defaults (company_id, tax_year)
VALUES ('comp_kc_clean', 2026)
ON CONFLICT (company_id, tax_year) DO NOTHING;

COMMIT;

-- =====================================================
-- PART 3: RLS
-- =====================================================

BEGIN;

ALTER TABLE public.payroll_tax_brackets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tax_brackets_manage_admin_payroll ON public.payroll_tax_brackets;
CREATE POLICY tax_brackets_manage_admin_payroll ON public.payroll_tax_brackets
  FOR ALL
  USING (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company())
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company());

ALTER TABLE public.payroll_tax_allowance_defaults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tax_allowance_defaults_manage_admin_payroll ON public.payroll_tax_allowance_defaults;
CREATE POLICY tax_allowance_defaults_manage_admin_payroll ON public.payroll_tax_allowance_defaults
  FOR ALL
  USING (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company())
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company());

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT * FROM public.payroll_rates WHERE company_id = 'comp_kc_clean' ORDER BY rate_type;
-- SELECT * FROM public.payroll_tax_brackets WHERE company_id = 'comp_kc_clean' ORDER BY bracket_order;
-- SELECT * FROM public.payroll_tax_allowance_defaults WHERE company_id = 'comp_kc_clean';
