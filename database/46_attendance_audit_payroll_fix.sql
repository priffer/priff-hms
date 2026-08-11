-- Migration 46: Fix attendance audit trigger for payroll role updates
--
-- JWT test as role=payroll showed attendance_logs UPDATE is allowed by
-- attendance_update_supervisor (migration 44), but AFTER UPDATE trigger
-- fn_attendance_audit() inserts into attendance_audit_logs as INVOKER.
-- That table has RLS with SELECT-only policy -> INSERT fails with 42501.
--
-- Fix: make the audit function SECURITY DEFINER (same pattern as other
-- attendance triggers) so audit rows are always written when a permitted
-- update succeeds. Also add an explicit INSERT policy for admin/payroll
-- as defense in depth.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_attendance_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

DROP POLICY IF EXISTS audit_insert_admin_payroll ON public.attendance_audit_logs;
CREATE POLICY audit_insert_admin_payroll ON public.attendance_audit_logs
  FOR INSERT
  WITH CHECK (
    public.get_user_role() IN ('admin', 'payroll')
    AND company_id = public.get_user_company()
  );

COMMIT;

-- Verification
-- As role=payroll JWT: PATCH attendance_logs break_minutes and confirm 200 + audit row inserted.
