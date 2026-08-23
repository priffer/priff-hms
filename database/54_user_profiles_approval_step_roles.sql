-- database/54_user_profiles_approval_step_roles.sql
-- Phase 3.5-3d: constrain user_profiles.role and add approval_step_role
-- (UI-level payroll line gating). Does not change payroll calculation.

BEGIN;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS approval_step_role text;

DO $$
BEGIN
  ALTER TABLE public.user_profiles
    ADD CONSTRAINT user_profiles_role_check
    CHECK (role IN ('admin','payroll','supervisor','employee','hr','accounting','executive'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.user_profiles
    ADD CONSTRAINT user_profiles_approval_step_role_check
    CHECK (approval_step_role IS NULL
           OR approval_step_role IN ('supervisor','hr','accounting','executive'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

UPDATE public.user_profiles
SET approval_step_role = role
WHERE role IN ('supervisor','hr','accounting','executive')
  AND (approval_step_role IS DISTINCT FROM role);

COMMIT;
