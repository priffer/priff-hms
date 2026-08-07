-- =====================================================
-- database/18_employee_benefits_profile.sql
-- ESS Redesign (รอบ 8): "สิทธิสวัสดิการของฉัน" - โครงสร้างข้อมูลรอไว้ก่อน
--
-- บริบท: user อยากให้พนักงานเช็คสิทธิสวัสดิการของตัวเองได้ (ค่าจ้างตามตำแหน่ง, สวัสดิการที่ได้,
-- อัตราประกันสังคมที่จ่าย, ภาษี, โรงพยาบาลตามสิทธิประกันสังคม) - ยืนยันแล้วว่ายังไม่มีข้อมูลจริง
-- ก็ให้ทำโครงสร้างรอไว้ก่อน เพื่อไม่ต้องย้อนกลับมาออกแบบใหม่ทีหลังตอนที่ Payroll Engine
-- เชื่อมต่อจริง (ผู้ใช้ระบุเหตุผลชัดเจนว่ากลัวว่าถ้าไม่ออกแบบไว้ก่อนจะยุ่งยากตอนย้อนกลับมาทำ)
--
-- ข้อมูลที่มีอยู่แล้วในระบบ (ไม่ต้องสร้างซ้ำ - employee เห็นได้อยู่แล้วผ่าน employees_select_self
-- policy เดิมใน 01_payroll_migration_v2.sql เพราะเป็น row-level RLS ไม่ใช่ column-level):
--   - employees.monthly_salary / hourly_rate / salary_type - ค่าจ้าง
--   - employees.social_security_base / social_security_employee_rate / social_security_employer_rate
--     - อัตราประกันสังคมที่หัก
--   - employees.tax_allowance_child / tax_allowance_other - ข้อมูลลดหย่อนภาษี
--
-- สิ่งที่ยังไม่มีเลยและสร้างในไฟล์นี้:
--   (1) โรงพยาบาลตามสิทธิประกันสังคม (ผู้ใช้ระบุเป็นตัวอย่างชัดเจน) - เพิ่มเป็น column บน
--       employees ตรงๆ เพราะเป็นข้อมูล 1:1 ต่อพนักงานเหมือนฟิลด์ประกันสังคมอื่นๆ ที่มีอยู่แล้ว
--   (2) รายการสวัสดิการ (เช่น ประกันสุขภาพกลุ่ม, ค่าเครื่องแบบ, ตรวจสุขภาพประจำปี) - เป็น
--       many-to-many ระหว่างพนักงานกับประเภทสวัสดิการ ต้องมีตาราง catalog (benefit_types)
--       + ตาราง assignment (employee_benefit_assignments) แยกต่างหาก
--
-- สำคัญ: ไฟล์นี้เตรียม "โครงสร้างข้อมูล" และ RLS ให้พนักงานอ่านของตัวเองได้เท่านั้น ไม่ได้เขียน
-- สูตรคำนวณเงินเดือน/ภาษี/ประกันสังคมใดๆ (นั่นเป็นหน้าที่ของ Payroll Engine ตาม
-- docs/payroll-architecture.md ที่ต้องปรึกษาก่อนแก้เสมอ) - ตอนนี้ทุก field ใหม่เป็น nullable
-- ทั้งหมด แสดงผล "รอข้อมูลจากฝ่ายบุคคล" ที่ฝั่ง UI ได้เลยถ้ายังไม่มีค่า
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

-- =====================================================
-- PART 1: ขยาย employees - ข้อมูลโรงพยาบาลตามสิทธิประกันสังคม
-- =====================================================

BEGIN;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS sso_hospital_name text,   -- ชื่อโรงพยาบาลตามสิทธิประกันสังคม (ม.33)
  ADD COLUMN IF NOT EXISTS sso_hospital_code text,    -- รหัสสถานพยาบาลตามประกันสังคม (ถ้ามี)
  ADD COLUMN IF NOT EXISTS sso_registered_at date;    -- วันที่มีผลของสิทธิ์โรงพยาบาลนี้

COMMIT;

-- =====================================================
-- PART 2: benefit_types - master data ประเภทสวัสดิการ (ต่อบริษัท)
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.benefit_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'comp_kc_clean',
  code text NOT NULL,
  name_th text NOT NULL,
  description text, -- รายละเอียดสวัสดิการ เช่น "คุ้มครองอุบัติเหตุ วงเงิน 100,000 บาท/ปี"
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT benefit_types_company_code_unique UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_benefit_types_company ON public.benefit_types (company_id);

-- Seed ตัวอย่างสวัสดิการทั่วไปที่มักพบในบริษัททำความสะอาด/แม่บ้าน (โครงสร้างตัวอย่าง
-- ไม่ใช่ข้อมูลจริง - admin/HR แก้ไข description ให้ตรงกับนโยบายจริงทีหลังได้)
INSERT INTO public.benefit_types (company_id, code, name_th, description)
VALUES
  ('comp_kc_clean', 'social_security', 'ประกันสังคม', 'รอข้อมูลจากฝ่ายบุคคล'),
  ('comp_kc_clean', 'group_health_insurance', 'ประกันสุขภาพกลุ่ม', 'รอข้อมูลจากฝ่ายบุคคล'),
  ('comp_kc_clean', 'uniform_allowance', 'ค่าเครื่องแบบ/อุปกรณ์ทำความสะอาด', 'รอข้อมูลจากฝ่ายบุคคล'),
  ('comp_kc_clean', 'annual_health_checkup', 'ตรวจสุขภาพประจำปี', 'รอข้อมูลจากฝ่ายบุคคล'),
  ('comp_kc_clean', 'provident_fund', 'กองทุนสำรองเลี้ยงชีพ', 'รอข้อมูลจากฝ่ายบุคคล')
ON CONFLICT (company_id, code) DO NOTHING;

COMMIT;

-- =====================================================
-- PART 3: employee_benefit_assignments - สวัสดิการที่พนักงานแต่ละคนได้รับจริง
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_benefit_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'comp_kc_clean',
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  benefit_type_id uuid NOT NULL REFERENCES public.benefit_types(id),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date, -- null = ยังมีผลอยู่ปัจจุบัน
  notes text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_employee_benefits_employee ON public.employee_benefit_assignments (employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_benefits_company ON public.employee_benefit_assignments (company_id);

COMMIT;

-- =====================================================
-- PART 4: RLS
-- =====================================================

BEGIN;

-- 4.1 benefit_types: อ่านได้ทุกคนใน company (master data ไม่ sensitive), แก้ไขได้เฉพาะ admin/payroll
ALTER TABLE public.benefit_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS benefit_types_select_all ON public.benefit_types;
CREATE POLICY benefit_types_select_all ON public.benefit_types
  FOR SELECT
  USING (company_id = public.get_user_company());

DROP POLICY IF EXISTS benefit_types_manage_admin_payroll ON public.benefit_types;
CREATE POLICY benefit_types_manage_admin_payroll ON public.benefit_types
  FOR ALL
  USING (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company())
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company());

-- 4.2 employee_benefit_assignments: employee เห็นเฉพาะของตัวเอง, admin/payroll จัดการได้เต็ม
ALTER TABLE public.employee_benefit_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_benefits_select ON public.employee_benefit_assignments;
CREATE POLICY employee_benefits_select ON public.employee_benefit_assignments
  FOR SELECT
  USING (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
    OR (
      public.get_user_role() = 'employee'
      AND employee_id = (SELECT employee_id FROM public.user_profiles WHERE auth_uid = auth.uid())
    )
  );

DROP POLICY IF EXISTS employee_benefits_manage_admin_payroll ON public.employee_benefit_assignments;
CREATE POLICY employee_benefits_manage_admin_payroll ON public.employee_benefit_assignments
  FOR ALL
  USING (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company())
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company());

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT * FROM public.benefit_types ORDER BY code;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'employees' AND column_name LIKE 'sso_%';
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN ('benefit_types','employee_benefit_assignments');
