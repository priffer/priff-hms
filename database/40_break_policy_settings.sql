-- =====================================================
-- database/40_break_policy_settings.sql
-- Attendance / Payroll: company-level break deduction policy
-- Mirrors the existing ot_policy_settings pattern intentionally
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.break_policy_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL UNIQUE DEFAULT 'comp_kc_clean',
  auto_break_threshold_hours numeric NOT NULL DEFAULT 6,
  auto_break_minutes integer NOT NULL DEFAULT 60,
  updated_by uuid,
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT break_policy_threshold_positive_check CHECK (auto_break_threshold_hours > 0),
  CONSTRAINT break_policy_minutes_nonnegative_check CHECK (auto_break_minutes >= 0),
  CONSTRAINT break_policy_minutes_reasonable_check CHECK (auto_break_minutes <= 1440)
);

-- Seed default row for the main staging company. Threshold/minutes remain configurable later.
INSERT INTO public.break_policy_settings (company_id)
VALUES ('comp_kc_clean')
ON CONFLICT (company_id) DO NOTHING;

COMMIT;

BEGIN;

ALTER TABLE public.break_policy_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS break_policy_select_all ON public.break_policy_settings;
CREATE POLICY break_policy_select_all ON public.break_policy_settings
  FOR SELECT
  USING (company_id = public.get_user_company());

DROP POLICY IF EXISTS break_policy_manage_admin_payroll ON public.break_policy_settings;
CREATE POLICY break_policy_manage_admin_payroll ON public.break_policy_settings
  FOR ALL
  USING (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company())
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company());

COMMIT;

-- Verification
-- SELECT * FROM public.break_policy_settings;
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'break_policy_settings';
