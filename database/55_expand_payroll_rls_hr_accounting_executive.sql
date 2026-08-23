-- database/55_expand_payroll_rls_hr_accounting_executive.sql
-- Expand payroll SELECT to approval-chain roles (supervisor/hr/accounting/executive)
-- and add a strict INSERT policy on payroll_approval_trail that matches
-- admin-payroll.js (deriveApprovalPointer + lastStep cap). Writes on
-- payroll_lines stay payroll/admin (new roles are read-only there).
-- Does not change payroll calculation.

BEGIN;

-- ---------------------------------------------------------------
-- Helpers: current step replay (same rules as admin-payroll.js)
-- SECURITY DEFINER so WITH CHECK on payroll_approval_trail can read
-- trail/lines without RLS recursion.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_approval_step_role()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT approval_step_role FROM public.user_profiles WHERE auth_uid = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_approval_step_role(p_step_order integer)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
AS $$
  SELECT CASE p_step_order
    WHEN 1 THEN 'supervisor'
    WHEN 2 THEN 'hr'
    WHEN 3 THEN 'accounting'
    WHEN 4 THEN 'executive'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.compute_current_approval_step(p_line_id uuid)
  RETURNS TABLE(
    pointer integer,
    step_role text,
    start_step integer,
    last_step integer,
    chain_complete boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_employee_id uuid;
  v_employment_type text;
  v_pay_frequency text;
  v_salary_type text;
  v_start integer;
  v_last integer;
  v_pointer integer;
  v_approver_role text;
  v_approver_id uuid;
  r record;
  v_pay_frequency_resolved text;
BEGIN
  SELECT pl.employee_id, e.employment_type, e.pay_frequency, e.salary_type
    INTO v_employee_id, v_employment_type, v_pay_frequency, v_salary_type
  FROM public.payroll_lines pl
  JOIN public.employees e ON e.id = pl.employee_id
  WHERE pl.id = p_line_id;

  IF v_employee_id IS NULL THEN
    RETURN;
  END IF;

  SELECT ra.approver_role, ra.approver_user_profile_id
    INTO v_approver_role, v_approver_id
  FROM public.resolve_approver_for_employee(v_employee_id) ra
  LIMIT 1;

  -- resolvePayrollStartStep(): supervisor with a profile id -> 1, else 2
  IF v_approver_role = 'supervisor' AND v_approver_id IS NOT NULL THEN
    v_start := 1;
  ELSE
    v_start := 2;
  END IF;

  -- isFreelancePayGroup() / chainLastStepForEmp(): freelance or daily -> 3, else 4
  v_pay_frequency_resolved := COALESCE(
    v_pay_frequency,
    CASE WHEN v_salary_type = 'monthly' THEN 'monthly' ELSE NULL END
  );
  IF v_employment_type = 'freelance' OR v_pay_frequency_resolved = 'daily' THEN
    v_last := 3;
  ELSE
    v_last := 4;
  END IF;

  -- deriveApprovalPointer(trail ordered by acted_at ASC, startStep)
  v_pointer := v_start;
  FOR r IN
    SELECT t.step_order, t.action
    FROM public.payroll_approval_trail t
    WHERE t.line_id = p_line_id
    ORDER BY t.acted_at ASC, t.id ASC
  LOOP
    IF r.action = 'approved' AND r.step_order = v_pointer THEN
      v_pointer := v_pointer + 1;
    ELSIF r.action = 'rejected' AND r.step_order = v_pointer THEN
      v_pointer := GREATEST(v_start, v_pointer - 1);
    END IF;
  END LOOP;

  pointer := v_pointer;
  step_role := public.fn_approval_step_role(v_pointer);
  start_step := v_start;
  last_step := v_last;
  chain_complete := v_pointer > v_last;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_approval_step_role() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_approval_step_role(integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_current_approval_step(uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------
-- payroll_periods: expand SELECT only (INSERT/UPDATE/DELETE unchanged)
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS periods_select_payroll_admin ON public.payroll_periods;
CREATE POLICY periods_select_payroll_admin ON public.payroll_periods
  FOR SELECT
  USING (
    public.get_user_company() = company_id
    AND public.get_user_role() = ANY (ARRAY['payroll'::text, 'admin'::text, 'supervisor'::text, 'hr'::text, 'accounting'::text, 'executive'::text])
  );

-- ---------------------------------------------------------------
-- payroll_runs: expand SELECT only
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS runs_select_payroll_admin ON public.payroll_runs;
CREATE POLICY runs_select_payroll_admin ON public.payroll_runs
  FOR SELECT
  USING (
    public.get_user_company() = company_id
    AND public.get_user_role() = ANY (ARRAY['payroll'::text, 'admin'::text, 'supervisor'::text, 'hr'::text, 'accounting'::text, 'executive'::text])
  );

-- ---------------------------------------------------------------
-- payroll_lines: split FOR ALL so new roles are SELECT-only
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS lines_payroll_admin ON public.payroll_lines;
DROP POLICY IF EXISTS lines_select_company ON public.payroll_lines;
DROP POLICY IF EXISTS lines_insert_payroll_admin ON public.payroll_lines;
DROP POLICY IF EXISTS lines_update_payroll_admin ON public.payroll_lines;
DROP POLICY IF EXISTS lines_delete_payroll_admin ON public.payroll_lines;

CREATE POLICY lines_select_company ON public.payroll_lines
  FOR SELECT
  USING (
    public.get_user_company() = company_id
    AND public.get_user_role() = ANY (ARRAY['payroll'::text, 'admin'::text, 'supervisor'::text, 'hr'::text, 'accounting'::text, 'executive'::text])
  );

CREATE POLICY lines_insert_payroll_admin ON public.payroll_lines
  FOR INSERT
  WITH CHECK (
    public.get_user_company() = company_id
    AND public.get_user_role() = ANY (ARRAY['payroll'::text, 'admin'::text])
  );

CREATE POLICY lines_update_payroll_admin ON public.payroll_lines
  FOR UPDATE
  USING (
    public.get_user_company() = company_id
    AND public.get_user_role() = ANY (ARRAY['payroll'::text, 'admin'::text])
  )
  WITH CHECK (
    public.get_user_company() = company_id
    AND public.get_user_role() = ANY (ARRAY['payroll'::text, 'admin'::text])
  );

CREATE POLICY lines_delete_payroll_admin ON public.payroll_lines
  FOR DELETE
  USING (
    public.get_user_company() = company_id
    AND public.get_user_role() = ANY (ARRAY['payroll'::text, 'admin'::text])
  );

-- ---------------------------------------------------------------
-- payroll_line_details: same split
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS linedetails_payroll_admin ON public.payroll_line_details;
DROP POLICY IF EXISTS linedetails_select_company ON public.payroll_line_details;
DROP POLICY IF EXISTS linedetails_insert_payroll_admin ON public.payroll_line_details;
DROP POLICY IF EXISTS linedetails_update_payroll_admin ON public.payroll_line_details;
DROP POLICY IF EXISTS linedetails_delete_payroll_admin ON public.payroll_line_details;

CREATE POLICY linedetails_select_company ON public.payroll_line_details
  FOR SELECT
  USING (
    public.get_user_company() = company_id
    AND public.get_user_role() = ANY (ARRAY['payroll'::text, 'admin'::text, 'supervisor'::text, 'hr'::text, 'accounting'::text, 'executive'::text])
  );

CREATE POLICY linedetails_insert_payroll_admin ON public.payroll_line_details
  FOR INSERT
  WITH CHECK (
    public.get_user_company() = company_id
    AND public.get_user_role() = ANY (ARRAY['payroll'::text, 'admin'::text])
  );

CREATE POLICY linedetails_update_payroll_admin ON public.payroll_line_details
  FOR UPDATE
  USING (
    public.get_user_company() = company_id
    AND public.get_user_role() = ANY (ARRAY['payroll'::text, 'admin'::text])
  )
  WITH CHECK (
    public.get_user_company() = company_id
    AND public.get_user_role() = ANY (ARRAY['payroll'::text, 'admin'::text])
  );

CREATE POLICY linedetails_delete_payroll_admin ON public.payroll_line_details
  FOR DELETE
  USING (
    public.get_user_company() = company_id
    AND public.get_user_role() = ANY (ARRAY['payroll'::text, 'admin'::text])
  );

-- ---------------------------------------------------------------
-- payroll_payslips: expand SELECT; manage (write) stays payroll/admin
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS payslips_select_owner ON public.payroll_payslips;
CREATE POLICY payslips_select_owner ON public.payroll_payslips
  FOR SELECT
  USING (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
    OR (
      public.get_user_role() = ANY (ARRAY['supervisor'::text, 'hr'::text, 'accounting'::text, 'executive'::text])
      AND company_id = public.get_user_company()
    )
    OR (
      public.get_user_role() = 'employee'
      AND employee_id = (SELECT user_profiles.employee_id FROM public.user_profiles WHERE auth_uid = auth.uid())
    )
  );

-- ---------------------------------------------------------------
-- payroll_approval_trail: SELECT for chain roles; INSERT current-step only;
-- UPDATE/DELETE stay payroll/admin
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS approval_trail_manage_payroll_admin ON public.payroll_approval_trail;
DROP POLICY IF EXISTS approval_trail_select_company ON public.payroll_approval_trail;
DROP POLICY IF EXISTS approval_trail_insert_current_step ON public.payroll_approval_trail;
DROP POLICY IF EXISTS approval_trail_update_payroll_admin ON public.payroll_approval_trail;
DROP POLICY IF EXISTS approval_trail_delete_payroll_admin ON public.payroll_approval_trail;

CREATE POLICY approval_trail_select_company ON public.payroll_approval_trail
  FOR SELECT
  USING (
    public.get_user_company() = company_id
    AND public.get_user_role() = ANY (ARRAY['payroll'::text, 'admin'::text, 'supervisor'::text, 'hr'::text, 'accounting'::text, 'executive'::text])
  );

CREATE POLICY approval_trail_insert_current_step ON public.payroll_approval_trail
  FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company()
    AND line_id IS NOT NULL
    AND approver_id = public.get_user_profile_id()
    AND EXISTS (
      SELECT 1
      FROM public.compute_current_approval_step(line_id) s
      WHERE s.pointer = step_order
        AND s.step_role IS NOT DISTINCT FROM payroll_approval_trail.step_role
        AND s.chain_complete = false
        AND step_order <= s.last_step
    )
    AND (
      public.get_user_role() = 'admin'
      OR public.get_user_approval_step_role() = step_role
    )
  );

CREATE POLICY approval_trail_update_payroll_admin ON public.payroll_approval_trail
  FOR UPDATE
  USING (
    public.get_user_company() = company_id
    AND public.get_user_role() = ANY (ARRAY['payroll'::text, 'admin'::text])
  )
  WITH CHECK (
    public.get_user_company() = company_id
    AND public.get_user_role() = ANY (ARRAY['payroll'::text, 'admin'::text])
  );

CREATE POLICY approval_trail_delete_payroll_admin ON public.payroll_approval_trail
  FOR DELETE
  USING (
    public.get_user_company() = company_id
    AND public.get_user_role() = ANY (ARRAY['payroll'::text, 'admin'::text])
  );

COMMIT;
