-- =====================================================
-- database/06_leave_management.sql
-- ESS Redesign: Leave Management Schema
--
-- บริบท: ฟีเจอร์ "ขออนุมัติลางาน" ใน ESS Portal ยังไม่มี schema รองรับเลย
-- (ไม่มีอยู่ใน schema.sql, 01_payroll_migration*.sql, หรือ docs ใดๆ มาก่อน)
-- ไฟล์นี้สร้างใหม่ทั้งหมด ผ่านการอนุมัติจากผู้ใช้งานแล้วก่อนรัน (ตาม .agent-rules.md
-- ที่ระบุว่าการเพิ่ม/เปลี่ยน schema ต้องได้รับอนุมัติก่อน)
--
-- แนวทางออกแบบยึด convention เดิมของโปรเจกต์:
--   - uuid primary key, company_id text (multi-tenant), timestamptz UTC
--   - เชื่อมกับพนักงานผ่าน employee_id (uuid -> employees.id) และ emp_id (text) คู่กัน
--     เหมือน attendance_logs / advance_payments / payroll_lines
--   - ใช้ RLS helper functions ที่มีอยู่แล้ว: get_user_role(), get_user_company(),
--     get_user_profile_id() (นิยามใน 01_payroll_migration_v2.sql PART 3)
--   - Policy pattern เดียวกับ attendance_logs / employees_select_self
--
-- สคริปต์นี้ Idempotent: ใช้ IF NOT EXISTS / DROP POLICY IF EXISTS ก่อน CREATE
-- รันบน Staging เท่านั้นก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

-- =====================================================
-- PART 1: TABLES
-- =====================================================

BEGIN;

-- 1.1 leave_types: master data ประเภทการลา ต่อบริษัท (รองรับ multi-tenant ในอนาคต)
CREATE TABLE IF NOT EXISTS public.leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'comp_kc_clean',
  code text NOT NULL, -- sick, personal, annual, maternity, ordination, unpaid
  name_th text NOT NULL,
  is_paid boolean NOT NULL DEFAULT true,
  max_days_per_year numeric,
  requires_attachment boolean NOT NULL DEFAULT false, -- เช่น ใบรับรองแพทย์ลาป่วยเกิน 3 วัน
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT leave_types_company_code_unique UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_leave_types_company ON public.leave_types (company_id);

-- 1.2 leave_balances: โควตาลาต่อพนักงาน/ปี (ไว้ต่อยอด payroll หักลาไม่รับเงินในอนาคต)
CREATE TABLE IF NOT EXISTS public.leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id),
  year integer NOT NULL,
  entitled_days numeric NOT NULL DEFAULT 0,
  used_days numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone,
  CONSTRAINT leave_balances_unique UNIQUE (employee_id, leave_type_id, year)
);
CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON public.leave_balances (employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_balances_company_year ON public.leave_balances (company_id, year);

-- 1.3 leave_requests: คำขอลาของพนักงาน
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  emp_id text NOT NULL,
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  total_days numeric NOT NULL,
  reason text,
  attachment_url text,
  status text NOT NULL DEFAULT 'pending', -- pending, approved, rejected, cancelled
  approved_by uuid,
  approved_at timestamp with time zone,
  rejection_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone,
  CONSTRAINT leave_requests_date_check CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON public.leave_requests (employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_emp_id ON public.leave_requests (emp_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_company_status ON public.leave_requests (company_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON public.leave_requests (start_date, end_date);

COMMIT;

-- =====================================================
-- PART 2: SEED DEFAULT LEAVE TYPES (idempotent upsert)
-- ตามกฎหมายแรงงานไทย: ลาป่วย, ลากิจ, ลาพักร้อน, ลาคลอด, ลาบวช, ลาไม่รับค่าจ้าง
-- =====================================================

BEGIN;

INSERT INTO public.leave_types (company_id, code, name_th, is_paid, max_days_per_year, requires_attachment)
VALUES
  ('comp_kc_clean', 'sick', 'ลาป่วย', true, 30, false),
  ('comp_kc_clean', 'personal', 'ลากิจ', true, 3, false),
  ('comp_kc_clean', 'annual', 'ลาพักร้อน', true, 6, false),
  ('comp_kc_clean', 'maternity', 'ลาคลอดบุตร', true, 98, true),
  ('comp_kc_clean', 'ordination', 'ลาบวช', false, 15, false),
  ('comp_kc_clean', 'unpaid', 'ลาโดยไม่รับค่าจ้าง', false, NULL, false)
ON CONFLICT (company_id, code) DO NOTHING;

COMMIT;

-- =====================================================
-- PART 3: ENABLE RLS & POLICIES
-- Pattern อ้างอิงจาก employees_select_self / attendance_logs policies
-- (01_payroll_migration_v2.sql PART 4, 05_rls_remediation.sql)
-- =====================================================

BEGIN;

-- 3.1 leave_types: ทุก role ที่ login แล้วอ่านได้ (master data ไม่ sensitive), เขียนได้เฉพาะ admin
ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_types_select_all ON public.leave_types;
CREATE POLICY leave_types_select_all ON public.leave_types
  FOR SELECT
  USING (company_id = public.get_user_company());

DROP POLICY IF EXISTS leave_types_manage_admin ON public.leave_types;
CREATE POLICY leave_types_manage_admin ON public.leave_types
  FOR ALL
  USING (public.get_user_role() = 'admin' AND company_id = public.get_user_company())
  WITH CHECK (public.get_user_role() = 'admin' AND company_id = public.get_user_company());

-- 3.2 leave_balances: employee เห็นเฉพาะของตัวเอง, supervisor เห็นแผนกเดียวกัน, admin/payroll เต็ม
ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_balances_select ON public.leave_balances;
CREATE POLICY leave_balances_select ON public.leave_balances
  FOR SELECT
  USING (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
    OR (public.get_user_role() = 'employee' AND employee_id = (SELECT employee_id FROM public.user_profiles WHERE auth_uid = auth.uid()))
    OR (
      public.get_user_role() = 'supervisor' AND company_id = public.get_user_company()
      AND employee_id IN (
        SELECT e.id FROM public.employees e
        WHERE e.department_id = (SELECT department_id FROM public.user_profiles WHERE auth_uid = auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS leave_balances_manage_admin_payroll ON public.leave_balances;
CREATE POLICY leave_balances_manage_admin_payroll ON public.leave_balances
  FOR ALL
  USING (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company())
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company());

-- 3.3 leave_requests
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

-- SELECT: employee=own, supervisor=department scope, payroll/admin=company scope
DROP POLICY IF EXISTS leave_requests_select ON public.leave_requests;
CREATE POLICY leave_requests_select ON public.leave_requests
  FOR SELECT
  USING (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
    OR (public.get_user_role() = 'employee' AND emp_id = (SELECT emp_id FROM public.user_profiles WHERE auth_uid = auth.uid()))
    OR (
      public.get_user_role() = 'supervisor' AND company_id = public.get_user_company()
      AND employee_id IN (
        SELECT e.id FROM public.employees e
        WHERE e.department_id = (SELECT department_id FROM public.user_profiles WHERE auth_uid = auth.uid())
      )
    )
  );

-- INSERT: employee สร้างคำขอของตัวเองเท่านั้น (บังคับ emp_id/company_id ให้ตรงกับ session)
DROP POLICY IF EXISTS leave_requests_insert_employee ON public.leave_requests;
CREATE POLICY leave_requests_insert_employee ON public.leave_requests
  FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company()
    AND (
      (public.get_user_role() = 'employee'
        AND emp_id = (SELECT emp_id FROM public.user_profiles WHERE auth_uid = auth.uid())
        AND employee_id = (SELECT employee_id FROM public.user_profiles WHERE auth_uid = auth.uid())
        AND status = 'pending')
      OR public.get_user_role() = 'admin'
    )
  );

-- UPDATE: employee ยกเลิกคำขอของตัวเองได้เฉพาะตอนยังเป็น pending (status -> cancelled)
-- supervisor/admin อนุมัติ/ปฏิเสธคำขอในสโคปของตน
DROP POLICY IF EXISTS leave_requests_update_self_cancel ON public.leave_requests;
CREATE POLICY leave_requests_update_self_cancel ON public.leave_requests
  FOR UPDATE
  USING (
    public.get_user_role() = 'admin'
    OR (
      public.get_user_role() = 'employee'
      AND emp_id = (SELECT emp_id FROM public.user_profiles WHERE auth_uid = auth.uid())
      AND status = 'pending'
    )
    OR (
      public.get_user_role() = 'supervisor' AND company_id = public.get_user_company()
      AND employee_id IN (
        SELECT e.id FROM public.employees e
        WHERE e.department_id = (SELECT department_id FROM public.user_profiles WHERE auth_uid = auth.uid())
      )
    )
  )
  WITH CHECK (
    public.get_user_role() = 'admin'
    OR (
      public.get_user_role() = 'employee'
      AND emp_id = (SELECT emp_id FROM public.user_profiles WHERE auth_uid = auth.uid())
      AND status IN ('pending', 'cancelled')
    )
    OR (
      public.get_user_role() = 'supervisor' AND company_id = public.get_user_company()
      AND employee_id IN (
        SELECT e.id FROM public.employees e
        WHERE e.department_id = (SELECT department_id FROM public.user_profiles WHERE auth_uid = auth.uid())
      )
    )
  );

-- DELETE: ห้ามทุก role ยกเว้น admin (เก็บ audit trail ไว้เสมอ ใช้ cancel แทน delete)
DROP POLICY IF EXISTS leave_requests_delete_admin ON public.leave_requests;
CREATE POLICY leave_requests_delete_admin ON public.leave_requests
  FOR DELETE
  USING (public.get_user_role() = 'admin' AND company_id = public.get_user_company());

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate เพื่อ sanity check)
-- =====================================================
-- SELECT * FROM public.leave_types;
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN ('leave_types','leave_balances','leave_requests');
