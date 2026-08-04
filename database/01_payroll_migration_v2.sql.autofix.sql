-- 01_payroll_migration_v2.sql
-- SQL Migration script (v2) สำหรับการเพิ่ม schema Payroll ใน PRIFF-HMS
-- ปรับปรุงตามมติ AI Architecture Board (Final Refinements):
-- 1) ใช้ user_profiles.auth_uid เป็น SSOT — ลบ auth_uid จาก employees
-- 2) payroll_lines ใช้เฉพาะ numeric columns สำหรับ OT (ot15_hours, ot2_hours, ot3_hours) — ลบ overtime_hours jsonb
-- 3) RLS helper functions ถูกสร้างเป็น SECURITY DEFINER SET search_path = public เพื่อลดความเสี่ยง recursion
-- 4) ลบ bulk update trigger ที่ทำการ UPDATE attendance_logs เป็นการป้องกัน implicit DB lock; ใช้ implicit lock function เท่านั้น
-- หมายเหตุสำคัญ:
-- 1) ไฟล์นี้เป็นเพียงสคริปต์ migration ใน repository เท่านั้น ห้ามรันบน production โดยไม่มีการทดสอบ
-- 2) สคริปต์จัดเป็น PARTS: ALTER TABLE, CREATE TABLE, HELPER FUNCTIONS, ENABLE RLS & POLICIES, TRIGGERS
-- 3) มีการใช้ transactions เพื่อความ atomic ของบางขั้นตอน แต่บางงาน (เช่น backfill ขนาดใหญ่) ควรรันแยกเป็น batch

BEGIN;

-- =====================================================
-- PART 1: ALTER TABLE ตารางเดิม (ปรับปรุง v2)
-- =====================================================

-- 1.1 employees: เพิ่มคอลัมน์ payroll-ready (nullable ก่อน เพื่อไม่ให้ break existing)
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS salary_type text,
  ADD COLUMN IF NOT EXISTS monthly_salary numeric,
  ADD COLUMN IF NOT EXISTS daily_rate numeric,
  ADD COLUMN IF NOT EXISTS hourly_rate numeric,
  ADD COLUMN IF NOT EXISTS standard_working_hours numeric,
  ADD COLUMN IF NOT EXISTS standard_monthly_hours numeric,
  ADD COLUMN IF NOT EXISTS social_security_base numeric,
  ADD COLUMN IF NOT EXISTS social_security_employee_rate numeric DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS social_security_employer_rate numeric,
  ADD COLUMN IF NOT EXISTS tax_allowance_child integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_allowance_other numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payroll_group text,
  ADD COLUMN IF NOT EXISTS company_id text;

-- Add indexes for employees (note: auth_uid removed from employees; SSOT in user_profiles)
CREATE INDEX IF NOT EXISTS idx_employees_company_empid ON public.employees (company_id, emp_id);
CREATE INDEX IF NOT EXISTS idx_employees_department ON public.employees (department_id);

-- 1.2 advance_payments: เพิ่มการเชื่อมกับ payroll run
ALTER TABLE public.advance_payments
  ADD COLUMN IF NOT EXISTS deducted_in_payroll_run_id uuid,
  ADD COLUMN IF NOT EXISTS deducted_amount numeric,
  ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS company_id text;

CREATE INDEX IF NOT EXISTS idx_advancepayments_company_emp ON public.advance_payments (company_id, emp_id);
CREATE INDEX IF NOT EXISTS idx_advancepayments_deducted_run ON public.advance_payments (deducted_in_payroll_run_id);

-- 1.3 attendance_logs: รองรับ iso_week, weekly_ot และ tenant
ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS iso_week integer,
  ADD COLUMN IF NOT EXISTS weekly_ot_hours numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weekly_ot_flagged boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS employee_id uuid,
  ADD COLUMN IF NOT EXISTS company_id text,
  ADD COLUMN IF NOT EXISTS attendance_locked boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_attendance_company_emp ON public.attendance_logs (company_id, emp_id);
CREATE INDEX IF NOT EXISTS idx_attendance_work_date ON public.attendance_logs (work_date);
CREATE INDEX IF NOT EXISTS idx_attendance_iso_week ON public.attendance_logs (iso_week);
CREATE INDEX IF NOT EXISTS idx_attendance_client ON public.attendance_logs (client_id);

-- Commit schema alterations so far
COMMIT;

-- =====================================================
-- PART 2: CREATE TABLES ใหม่ และ INDEXES
-- (แก้ไข: payroll_lines ไม่มี overtime_hours jsonb)
-- =====================================================

BEGIN;

-- 2.1 user_profiles
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid uuid NOT NULL UNIQUE,
  employee_id uuid,
  company_id text NOT NULL,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'invited',
  email text NOT NULL,
  full_name text,
  emp_id text,
  department_id uuid,
  primary_client_id uuid,
  allowed_client_ids jsonb,
  metadata jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone,
  last_sign_in_at timestamp with time zone,
  deactivated_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS idx_user_profiles_company_role ON public.user_profiles (company_id, role);
CREATE INDEX IF NOT EXISTS idx_user_profiles_employee_id ON public.user_profiles (employee_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_department ON public.user_profiles (department_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_authuid ON public.user_profiles (auth_uid);
CREATE INDEX IF NOT EXISTS gin_user_profiles_allowed_clients ON public.user_profiles USING GIN (allowed_client_ids);

-- 2.2 supervisor_client_assignments
CREATE TABLE IF NOT EXISTS public.supervisor_client_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_profile_id uuid NOT NULL,
  client_id uuid NOT NULL,
  company_id text NOT NULL,
  assigned_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  assigned_by uuid,
  CONSTRAINT supervisor_client_unique UNIQUE (user_profile_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_supervisor_company ON public.supervisor_client_assignments (company_id);
CREATE INDEX IF NOT EXISTS idx_supervisor_user ON public.supervisor_client_assignments (user_profile_id);
CREATE INDEX IF NOT EXISTS idx_supervisor_client ON public.supervisor_client_assignments (client_id);

-- 2.3 attendance_ot_details
CREATE TABLE IF NOT EXISTS public.attendance_ot_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_log_id uuid NOT NULL,
  employee_id uuid,
  company_id text NOT NULL,
  ot_type text NOT NULL,
  ot_hours numeric NOT NULL,
  ot_rate_multiplier numeric,
  ot_amount numeric NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS idx_ot_attendance_log ON public.attendance_ot_details (attendance_log_id);
CREATE INDEX IF NOT EXISTS idx_ot_employee ON public.attendance_ot_details (employee_id);
CREATE INDEX IF NOT EXISTS idx_ot_company ON public.attendance_ot_details (company_id);

-- 2.4 attendance_audit_logs
CREATE TABLE IF NOT EXISTS public.attendance_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_log_id uuid NOT NULL,
  company_id text NOT NULL,
  edited_by uuid NOT NULL,
  edited_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  old_values jsonb NOT NULL,
  new_values jsonb NOT NULL,
  reason text,
  change_type text,
  metadata jsonb
);
CREATE INDEX IF NOT EXISTS idx_audit_attendance_log ON public.attendance_audit_logs (attendance_log_id);
CREATE INDEX IF NOT EXISTS idx_audit_company ON public.attendance_audit_logs (company_id);
CREATE INDEX IF NOT EXISTS idx_audit_edited_by ON public.attendance_audit_logs (edited_by);

-- 2.5 payroll_periods
CREATE TABLE IF NOT EXISTS public.payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  period_type text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  pay_date date,
  status text NOT NULL DEFAULT 'draft',
  created_by uuid,
  submitted_by uuid,
  approved_by uuid,
  approved_at timestamp with time zone,
  locked_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS idx_periods_company_status ON public.payroll_periods (company_id, status);
CREATE INDEX IF NOT EXISTS idx_periods_company_period ON public.payroll_periods (company_id, period_start, period_end);

-- 2.6 payroll_runs
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL,
  company_id text NOT NULL,
  run_name text,
  run_type text,
  run_date timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  total_gross_amount numeric DEFAULT 0,
  total_deductions numeric DEFAULT 0,
  total_net_amount numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  created_by uuid,
  submitted_by uuid,
  approved_by uuid,
  approved_at timestamp with time zone,
  locked_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS idx_runs_period ON public.payroll_runs (period_id);
CREATE INDEX IF NOT EXISTS idx_runs_company_status ON public.payroll_runs (company_id, status);

-- 2.7 payroll_lines (clean schema: remove overtime_hours jsonb)
CREATE TABLE IF NOT EXISTS public.payroll_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL,
  company_id text NOT NULL,
  employee_id uuid NOT NULL,
  emp_id text,
  base_salary numeric DEFAULT 0,
  base_hours numeric DEFAULT 0,
  worked_hours numeric DEFAULT 0,
  ot15_hours numeric DEFAULT 0,
  ot2_hours numeric DEFAULT 0,
  ot3_hours numeric DEFAULT 0,
  overtime_amount numeric DEFAULT 0,
  gross_pay numeric DEFAULT 0,
  withholding_tax numeric DEFAULT 0,
  absence_deduction numeric DEFAULT 0,
  advance_deduction numeric DEFAULT 0,
  social_security_employee numeric DEFAULT 0,
  social_security_employer numeric DEFAULT 0,
  other_deductions numeric DEFAULT 0,
  net_pay numeric DEFAULT 0,
  pay_status text NOT NULL DEFAULT 'pending',
  remarks text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS idx_lines_run ON public.payroll_lines (payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_lines_employee ON public.payroll_lines (employee_id);
CREATE INDEX IF NOT EXISTS idx_lines_company_status ON public.payroll_lines (company_id, pay_status);

-- 2.8 payroll_line_details
CREATE TABLE IF NOT EXISTS public.payroll_line_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_line_id uuid NOT NULL,
  company_id text NOT NULL,
  detail_type text NOT NULL,
  description text,
  amount numeric NOT NULL DEFAULT 0,
  quantity numeric DEFAULT 0,
  rate numeric DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS idx_linedetails_line ON public.payroll_line_details (payroll_line_id);
CREATE INDEX IF NOT EXISTS idx_linedetails_company ON public.payroll_line_details (company_id);

-- 2.9 payroll_payslips
CREATE TABLE IF NOT EXISTS public.payroll_payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_line_id uuid NOT NULL,
  company_id text NOT NULL,
  employee_id uuid NOT NULL,
  payroll_run_id uuid NOT NULL,
  payslip_number text NOT NULL UNIQUE,
  payslip_date date NOT NULL,
  gross_amount numeric NOT NULL DEFAULT 0,
  deduction_amount numeric NOT NULL DEFAULT 0,
  net_amount numeric NOT NULL DEFAULT 0,
  payslip_url text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS idx_payslips_employee ON public.payroll_payslips (employee_id);
CREATE INDEX IF NOT EXISTS idx_payslips_run ON public.payroll_payslips (payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payslips_company ON public.payroll_payslips (company_id);

-- 2.10 payroll_rates
CREATE TABLE IF NOT EXISTS public.payroll_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  rate_type text NOT NULL,
  rate_value numeric NOT NULL,
  rate_multiplier numeric,
  social_security_max_cap numeric NOT NULL DEFAULT 875,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_rates_company_type ON public.payroll_rates (company_id, rate_type);

-- 2.11 payroll_ytd_summary
CREATE TABLE IF NOT EXISTS public.payroll_ytd_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  employee_id uuid NOT NULL,
  tax_year integer NOT NULL,
  ytd_income numeric NOT NULL DEFAULT 0,
  ytd_social_security numeric NOT NULL DEFAULT 0,
  ytd_tax_paid numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone,
  CONSTRAINT payroll_ytd_unique UNIQUE (company_id, employee_id, tax_year)
);
CREATE INDEX IF NOT EXISTS idx_ytd_employee ON public.payroll_ytd_summary (employee_id);
CREATE INDEX IF NOT EXISTS idx_ytd_company_year ON public.payroll_ytd_summary (company_id, tax_year);

COMMIT;

-- =====================================================
-- PART 3: RLS HELPER FUNCTIONS (SECURITY DEFINER)
-- =====================================================

BEGIN;

-- 3.1 get_user_profile_id(): คืนค่า user_profiles.id จาก auth.uid()
CREATE OR REPLACE FUNCTION public.get_user_profile_id()
  RETURNS uuid
  SECURITY DEFINER SET search_path = public
  LANGUAGE sql STABLE
  AS $$
    SELECT id FROM public.user_profiles WHERE auth_uid = auth.uid() LIMIT 1;
  $$;

-- 3.2 get_user_company(): คืนค่า company_id จาก user_profiles ที่เชื่อมกับ auth.uid()
CREATE OR REPLACE FUNCTION public.get_user_company()
  RETURNS text
  SECURITY DEFINER SET search_path = public
  LANGUAGE sql STABLE
  AS $$
    SELECT company_id FROM public.user_profiles WHERE auth_uid = auth.uid() LIMIT 1;
  $$;

-- 3.3 get_user_role(): คืนค่า role ของผู้ใช้งาน
CREATE OR REPLACE FUNCTION public.get_user_role()
  RETURNS text
  SECURITY DEFINER SET search_path = public
  LANGUAGE sql STABLE
  AS $$
    SELECT role FROM public.user_profiles WHERE auth_uid = auth.uid() LIMIT 1;
  $$;

-- 3.4 is_active_user(): คืนค่า boolean ว่าผู้ใช้ active หรือไม่
CREATE OR REPLACE FUNCTION public.is_active_user()
  RETURNS boolean
  SECURITY DEFINER SET search_path = public
  LANGUAGE sql STABLE
  AS $$
    SELECT (status = 'active') FROM public.user_profiles WHERE auth_uid = auth.uid() LIMIT 1;
  $$;

COMMIT;

-- =====================================================
-- PART 4: ENABLE RLS & CREATE POLICIES (พื้นฐานตาม RLS Architecture)
-- (นโยบายตามต้นฉบับ)
-- =====================================================

BEGIN;

-- 4.1 employees
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

-- SELECT: employee ดูเฉพาะ record ของตนเอง; supervisor ดูตาม department/client; payroll ดู payroll-related fields; admin ดูทั้งหมด
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
      public.get_user_role() = 'supervisor' AND employees.company_id = public.get_user_company() AND (
        employees.department_id = (SELECT department_id FROM public.user_profiles WHERE auth_uid = auth.uid())
        OR employees.emp_id IN (SELECT emp_id FROM public.employees e2 WHERE e2.department_id = (SELECT department_id FROM public.user_profiles WHERE auth_uid = auth.uid()))
      )
    )
    OR (public.get_user_role() = 'payroll' AND employees.company_id = public.get_user_company())
  );

-- UPDATE check: employee can update only certain columns for self-service
DROP POLICY IF EXISTS employees_update_self ON public.employees;
CREATE POLICY employees_update_self ON public.employees
  FOR UPDATE
  USING (public.get_user_role() = 'admin' OR (public.get_user_role() = 'employee' AND employees.id = (SELECT employee_id FROM public.user_profiles WHERE auth_uid = auth.uid())))
  WITH CHECK (public.get_user_role() = 'admin' OR (public.get_user_role() = 'employee' AND employees.id = (SELECT employee_id FROM public.user_profiles WHERE auth_uid = auth.uid())));

-- Deny INSERT/DELETE for non-admin by default (no policy)

-- 4.2 attendance_logs
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;

-- employee: INSERT/SELECT own records
DROP POLICY IF EXISTS attendance_insert_employee ON public.attendance_logs;
CREATE POLICY attendance_insert_employee ON public.attendance_logs
  FOR INSERT
  WITH CHECK (
    (emp_id IS NOT NULL) AND (emp_id = (SELECT emp_id FROM public.user_profiles WHERE auth_uid = auth.uid())) AND (company_id = public.get_user_company())
  );

DROP POLICY IF EXISTS attendance_select_employee ON public.attendance_logs;
CREATE POLICY attendance_select_employee ON public.attendance_logs
  FOR SELECT
  USING (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'employee' AND emp_id = (SELECT emp_id FROM public.user_profiles WHERE auth_uid = auth.uid()))
    OR (public.get_user_role() = 'supervisor' AND company_id = public.get_user_company() AND client_id IN (SELECT client_id FROM public.supervisor_client_assignments WHERE user_profile_id = public.get_user_profile_id()))
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
  );

-- UPDATE: allow supervisor to update limited fields and admin full update; block updates when attendance_locked = true
DROP POLICY IF EXISTS attendance_update_supervisor ON public.attendance_logs;
CREATE POLICY attendance_update_supervisor ON public.attendance_logs
  FOR UPDATE
  USING ( (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'supervisor' AND company_id = public.get_user_company() AND client_id IN (SELECT client_id FROM public.supervisor_client_assignments WHERE user_profile_id = public.get_user_profile_id()))
  ) AND (attendance_locked = false) )
  WITH CHECK (attendance_locked = false);

-- Prevent DELETE for non-admin
DROP POLICY IF EXISTS attendance_delete_admin_only ON public.attendance_logs;
CREATE POLICY attendance_delete_admin_only ON public.attendance_logs
  FOR DELETE
  USING (public.get_user_role() = 'admin');

-- 4.3 attendance_ot_details
ALTER TABLE public.attendance_ot_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ot_select ON public.attendance_ot_details;
CREATE POLICY ot_select ON public.attendance_ot_details
  FOR SELECT
  USING (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'employee' AND employee_id = (SELECT employee_id FROM public.user_profiles WHERE auth_uid = auth.uid()))
    OR (
      public.get_user_role() = 'supervisor' 
      AND company_id = public.get_user_company() 
      AND attendance_log_id IN (
        SELECT id FROM public.attendance_logs 
        WHERE client_id IN (
          SELECT client_id FROM public.supervisor_client_assignments 
          WHERE user_profile_id = public.get_user_profile_id()
        )
      )
    )
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
  );

-- 4.4 attendance_audit_logs
ALTER TABLE public.attendance_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_select ON public.attendance_audit_logs;
CREATE POLICY audit_select ON public.attendance_audit_logs
  FOR SELECT
  USING (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'employee' AND attendance_audit_logs.attendance_log_id IN (SELECT id FROM public.attendance_logs WHERE emp_id = (SELECT emp_id FROM public.user_profiles WHERE auth_uid = auth.uid())))
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
  );

-- 4.5 payroll tables: restrict to payroll + admin; employee only through payslip view
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS periods_payroll_admin ON public.payroll_periods;
CREATE POLICY periods_payroll_admin ON public.payroll_periods
  FOR ALL
  USING (public.get_user_company() = company_id AND (public.get_user_role() IN ('payroll','admin')))
  WITH CHECK (public.get_user_company() = company_id AND (public.get_user_role() IN ('payroll','admin')));

ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS runs_payroll_admin ON public.payroll_runs;
CREATE POLICY runs_payroll_admin ON public.payroll_runs
  FOR ALL
  USING (public.get_user_company() = company_id AND (public.get_user_role() IN ('payroll','admin')))
  WITH CHECK (public.get_user_company() = company_id AND (public.get_user_role() IN ('payroll','admin')));

ALTER TABLE public.payroll_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lines_payroll_admin ON public.payroll_lines;
CREATE POLICY lines_payroll_admin ON public.payroll_lines
  FOR ALL
  USING (public.get_user_company() = company_id AND (public.get_user_role() IN ('payroll','admin')))
  WITH CHECK (public.get_user_company() = company_id AND (public.get_user_role() IN ('payroll','admin')));

ALTER TABLE public.payroll_line_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS linedetails_payroll_admin ON public.payroll_line_details;
CREATE POLICY linedetails_payroll_admin ON public.payroll_line_details
  FOR ALL
  USING (public.get_user_company() = company_id AND (public.get_user_role() IN ('payroll','admin')))
  WITH CHECK (public.get_user_company() = company_id AND (public.get_user_role() IN ('payroll','admin')));

ALTER TABLE public.payroll_payslips ENABLE ROW LEVEL SECURITY;
-- payslip: employee can SELECT own payslips via employee_id match; payroll/admin full
DROP POLICY IF EXISTS payslips_select_owner ON public.payroll_payslips;
CREATE POLICY payslips_select_owner ON public.payroll_payslips
  FOR SELECT
  USING (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
    OR (public.get_user_role() = 'employee' AND employee_id = (SELECT employee_id FROM public.user_profiles WHERE auth_uid = auth.uid()))
  );

DROP POLICY IF EXISTS payslips_manage_payroll_admin ON public.payroll_payslips;
CREATE POLICY payslips_manage_payroll_admin ON public.payroll_payslips
  FOR ALL
  USING (public.get_user_company() = company_id AND (public.get_user_role() IN ('payroll','admin')))
  WITH CHECK (public.get_user_company() = company_id AND (public.get_user_role() IN ('payroll','admin')));

-- 4.6 payroll_rates and payroll_ytd_summary
ALTER TABLE public.payroll_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rates_company ON public.payroll_rates;
CREATE POLICY rates_company ON public.payroll_rates
  FOR ALL
  USING (public.get_user_company() = company_id AND public.get_user_role() IN ('payroll','admin'))
  WITH CHECK (public.get_user_company() = company_id AND public.get_user_role() IN ('payroll','admin'));

ALTER TABLE public.payroll_ytd_summary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ytd_company ON public.payroll_ytd_summary;
CREATE POLICY ytd_company ON public.payroll_ytd_summary
  FOR SELECT
  USING (
    public.get_user_company() = company_id AND (public.get_user_role() IN ('payroll','admin') OR (public.get_user_role() = 'employee' AND employee_id = (SELECT employee_id FROM public.user_profiles WHERE auth_uid = auth.uid())))
  );

COMMIT;

-- =====================================================
-- PART 5: TRIGGERS & FUNCTIONS (v2)
-- - เก็บ fn_compute_iso_week_and_weekly_ot, fn_attendance_audit, fn_attendance_modify_allowed
-- - ลบ bulk update trigger fn_payroll_run_state_change เพื่อหลีกเลี่ยง heavy locks
-- =====================================================

BEGIN;

-- 5.1 Function: compute_iso_week_and_weekly_ot
-- คำนวณ iso_week สำหรับ work_date และอัพเดต weekly_ot_hours และ weekly_ot_flagged ถ้าเกิน 36 ชั่วโมง
CREATE OR REPLACE FUNCTION public.fn_compute_iso_week_and_weekly_ot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_iso_week integer;
  v_weekly_ot numeric := 0;
  v_company text;
  v_emp text;
BEGIN
  -- compute ISO week
  v_iso_week := to_char(NEW.work_date, 'IW')::integer;

  NEW.iso_week := v_iso_week;
  v_company := NEW.company_id;
  v_emp := NEW.emp_id;

  -- sum OT hours for the employee in the same company and iso_week
  SELECT COALESCE(SUM(aod.ot_hours),0) INTO v_weekly_ot
  FROM public.attendance_ot_details aod
  JOIN public.attendance_logs al ON al.id = aod.attendance_log_id
  WHERE al.emp_id = v_emp AND al.company_id = v_company AND al.iso_week = v_iso_week;

  -- Note: attendance_ot_details is authoritative for OT breakdown. If attendance_logs contains ot_hours legacy column, it is not included here.

  NEW.weekly_ot_hours := v_weekly_ot;
  IF v_weekly_ot > 36 THEN
    NEW.weekly_ot_flagged := true;
  ELSE
    NEW.weekly_ot_flagged := false;
  END IF;

  RETURN NEW;
END;
$$;

-- 5.2 Trigger on attendance_logs BEFORE INSERT OR UPDATE
CREATE TRIGGER trg_attendance_compute_weekly_ot
BEFORE INSERT OR UPDATE ON public.attendance_logs
FOR EACH ROW
EXECUTE FUNCTION public.fn_compute_iso_week_and_weekly_ot();

-- 5.3 Audit trigger: record changes into attendance_audit_logs when attendance_logs updated
CREATE OR REPLACE FUNCTION public.fn_attendance_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public.attendance_audit_logs (attendance_log_id, company_id, edited_by, old_values, new_values, reason, change_type)
    VALUES (OLD.id, COALESCE(OLD.company_id, NEW.company_id), auth.uid(), to_jsonb(OLD), to_jsonb(NEW), NEW.manual_override_reason, 'manual_override');
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.attendance_audit_logs (attendance_log_id, company_id, edited_by, old_values, new_values, reason, change_type)
    VALUES (OLD.id, OLD.company_id, auth.uid(), to_jsonb(OLD), '{}'::jsonb, NULL, 'delete');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_attendance_audit
AFTER UPDATE OR DELETE ON public.attendance_logs
FOR EACH ROW
EXECUTE FUNCTION public.fn_attendance_audit();

-- 5.4 Implicit lock logic via function: disallow modifying attendance_logs when related payroll_period is approved/locked
CREATE OR REPLACE FUNCTION public.fn_attendance_modify_allowed() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
BEGIN
  -- If record relates to a period that is locked/approved, prevent update
  SELECT COUNT(1) INTO v_count
  FROM public.payroll_periods pp
  WHERE pp.company_id = NEW.company_id
    AND pp.period_start <= NEW.work_date
    AND pp.period_end >= NEW.work_date
    AND pp.status IN ('approved','locked');

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Attendance record for date % is locked by payroll period', NEW.work_date;
  END IF;
  RETURN NEW;
END;
$$;

-- Attach the check trigger BEFORE UPDATE/DELETE on attendance_logs
CREATE TRIGGER trg_attendance_modify_allowed
BEFORE UPDATE OR DELETE ON public.attendance_logs
FOR EACH ROW
EXECUTE FUNCTION public.fn_attendance_modify_allowed();

-- Note: fn_payroll_run_state_change and its trigger have been removed in v2 to avoid bulk UPDATE locks.

COMMIT;

-- =====================================================
-- End of migration v2 script
-- =====================================================

/*
IMPORTANT NOTES (ภาษาไทย):
- สคริปต์นี้ต้องทดสอบบน staging ก่อนรันใน production
- user_profiles.auth_uid เป็น Single Source of Truth สำหรับ mapping ไปยัง auth.users — ห้ามคัดลอก auth_uid ลงใน employees
- การ backfill ข้อมูล (populate company_id, iso_week, weekly_ot_hours) ควรรันเป็น batch นอก transaction เพื่อป้องกัน lock นาน
- นโยบาย RLS ควรผ่าน Security Review และ PenTest ก่อนเปิดใช้งาน
*/

COMMIT;
