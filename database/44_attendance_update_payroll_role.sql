-- Migration 44: Allow role 'payroll' to UPDATE attendance_logs
--
-- admin-attendance.html is gated to admin+payroll, and break edits
-- update attendance_logs from the browser client. Existing policy
-- attendance_update_supervisor only allowed admin/supervisor, so
-- payroll role saves failed at RLS.
--
-- Scope matches break_policy_manage_admin_payroll: admin + payroll
-- within the user's company. Supervisor path unchanged.

BEGIN;

DROP POLICY IF EXISTS attendance_update_supervisor ON public.attendance_logs;
CREATE POLICY attendance_update_supervisor ON public.attendance_logs
  FOR UPDATE
  USING (
    (
      public.get_user_role() = 'admin'
      OR (
        public.get_user_role() = 'payroll'
        AND company_id = public.get_user_company()
      )
      OR (
        public.get_user_role() = 'supervisor'
        AND company_id = public.get_user_company()
        AND client_id IN (
          SELECT client_id
          FROM public.supervisor_client_assignments
          WHERE user_profile_id = public.get_user_profile_id()
        )
      )
    )
    AND (attendance_locked = false)
  )
  WITH CHECK (attendance_locked = false);

COMMIT;

-- Verification
-- SELECT policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE tablename = 'attendance_logs' AND policyname = 'attendance_update_supervisor';
