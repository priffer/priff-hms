-- =====================================================
-- database/05_rls_remediation.sql
-- PHASE 13B: RLS Critical Remediation
-- อ้างอิง docs/authenticated-rls-final-report.md Section 7 (#1, #2, #3, #4)
--
-- แก้ 3 ช่องโหว่ Critical ที่พบใน PHASE 13A:
--   1) Legacy permissive policies (USING(true)) บน employees / attendance_logs
--   2) user_profiles และ supervisor_client_assignments ไม่มี RLS เปิดใช้งานเลย
--   3) employees_select_self มี infinite recursion bug (self-referential subquery)
--
-- สคริปต์นี้เป็น Idempotent: DROP POLICY IF EXISTS ก่อน CREATE POLICY ทุกครั้ง
-- สามารถรันซ้ำได้โดยไม่เกิด error "already exists"
-- ไม่มีการแก้ไข Schema (ไม่มี CREATE/DROP/ALTER TABLE เพิ่มคอลัมน์/ตารางใหม่)
-- =====================================================

BEGIN;

-- =====================================================
-- FIX #1: ลบ Legacy Permissive Policies (USING(true)) บน employees และ attendance_logs
-- (พบทั้ง 7 รายการจาก pg_policies ตรงกับรายงาน Section 3.1)
-- =====================================================

-- attendance_logs
DROP POLICY IF EXISTS "Allow admin full access" ON public.attendance_logs;
DROP POLICY IF EXISTS "Allow public select on attendance_logs" ON public.attendance_logs;
DROP POLICY IF EXISTS "Allow public insert on attendance_logs" ON public.attendance_logs;
DROP POLICY IF EXISTS "Allow public update on attendance_logs" ON public.attendance_logs;

-- employees
DROP POLICY IF EXISTS "Allow admin full access" ON public.employees;
DROP POLICY IF EXISTS "Allow public read access to employees" ON public.employees;
DROP POLICY IF EXISTS "Allow public insert" ON public.employees;

-- =====================================================
-- FIX #3: แก้ employees_select_self infinite recursion
-- สาเหตุ: supervisor branch เดิม query กลับไปที่ตาราง employees เอง
--   (emp_id IN (SELECT e2.emp_id FROM employees e2 WHERE e2.department_id = ...))
-- เงื่อนไขนี้ซ้ำซ้อนกับเงื่อนไขก่อนหน้า (employees.department_id = ...) อยู่แล้ว
-- และไม่จำเป็นต้อง query ตาราง employees ซ้ำเพื่อตรวจสอบแผนกเดียวกัน
-- จึงตัดเงื่อนไขที่ recursive ออก โดยยังคงผลลัพธ์ (supervisor เห็นพนักงานแผนกเดียวกัน) เหมือนเดิม
-- =====================================================

DROP POLICY IF EXISTS employees_select_self ON public.employees;
CREATE POLICY employees_select_self ON public.employees
  FOR SELECT
  USING (
    (
      public.get_user_role() = 'admin'
    )
    OR (
      public.get_user_role() = 'employee' AND employees.id = (SELECT employee_id FROM public.user_profiles WHERE auth_uid = auth.uid())
    )
    OR (
      public.get_user_role() = 'supervisor' AND employees.company_id = public.get_user_company()
      AND employees.department_id = (SELECT department_id FROM public.user_profiles WHERE auth_uid = auth.uid())
    )
    OR (public.get_user_role() = 'payroll' AND employees.company_id = public.get_user_company())
  );

-- employees_update_self ไม่มีปัญหา recursion (ไม่ได้แก้ไข คงไว้ตามเดิม)

-- =====================================================
-- FIX #2: เปิด RLS บน user_profiles และ supervisor_client_assignments
-- พร้อม Policy ขั้นต่ำที่จำเป็น (self-select + company-scoped admin/payroll access)
-- Helper functions (get_user_role/get_user_company/get_user_profile_id/is_active_user)
-- เป็น SECURITY DEFINER และตารางเป็นของ Owner เดียวกัน จึง bypass RLS ได้ตามปกติ
-- (ไม่มี FORCE ROW LEVEL SECURITY ในระบบนี้) จึงไม่เกิด recursion เพิ่มเติมจากการเปิด RLS นี้
-- =====================================================

-- 2.1 user_profiles
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_profiles_select_self ON public.user_profiles;
CREATE POLICY user_profiles_select_self ON public.user_profiles
  FOR SELECT
  USING (auth_uid = auth.uid());

DROP POLICY IF EXISTS user_profiles_select_company_admin_payroll ON public.user_profiles;
CREATE POLICY user_profiles_select_company_admin_payroll ON public.user_profiles
  FOR SELECT
  USING (
    public.get_user_role() IN ('admin', 'payroll')
    AND company_id = public.get_user_company()
  );

DROP POLICY IF EXISTS user_profiles_select_supervisor_company ON public.user_profiles;
CREATE POLICY user_profiles_select_supervisor_company ON public.user_profiles
  FOR SELECT
  USING (
    public.get_user_role() = 'supervisor'
    AND company_id = public.get_user_company()
  );

DROP POLICY IF EXISTS user_profiles_manage_admin ON public.user_profiles;
CREATE POLICY user_profiles_manage_admin ON public.user_profiles
  FOR ALL
  USING (
    public.get_user_role() = 'admin'
    AND company_id = public.get_user_company()
  )
  WITH CHECK (
    public.get_user_role() = 'admin'
    AND company_id = public.get_user_company()
  );

-- 2.2 supervisor_client_assignments
ALTER TABLE public.supervisor_client_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supervisor_assignments_select_self ON public.supervisor_client_assignments;
CREATE POLICY supervisor_assignments_select_self ON public.supervisor_client_assignments
  FOR SELECT
  USING (
    user_profile_id = public.get_user_profile_id()
    OR (
      public.get_user_role() IN ('admin', 'payroll')
      AND company_id = public.get_user_company()
    )
  );

DROP POLICY IF EXISTS supervisor_assignments_manage_admin ON public.supervisor_client_assignments;
CREATE POLICY supervisor_assignments_manage_admin ON public.supervisor_client_assignments
  FOR ALL
  USING (
    public.get_user_role() = 'admin'
    AND company_id = public.get_user_company()
  )
  WITH CHECK (
    public.get_user_role() = 'admin'
    AND company_id = public.get_user_company()
  );

COMMIT;

-- =====================================================
-- END OF database/05_rls_remediation.sql
-- =====================================================
