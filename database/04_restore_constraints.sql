-- database/04_restore_constraints.sql
-- Rollback script to restore constraints modified for staging test runs
-- Idempotent and safe: fills NULLs in attendance_audit_logs.edited_by then sets NOT NULL

BEGIN;

-- Ensure an admin user_profile exists to be used as placeholder if needed
DO $$
DECLARE placeholder uuid;
BEGIN
  SELECT id INTO placeholder FROM public.user_profiles WHERE role = 'admin' LIMIT 1;
  IF placeholder IS NULL THEN
    placeholder := gen_random_uuid();
    INSERT INTO public.user_profiles (id, auth_uid, employee_id, company_id, role, status, email, full_name, created_at)
    VALUES (placeholder, gen_random_uuid(), NULL, 'comp_kc_clean', 'admin', 'active', 'staging-admin@local', 'Staging Admin', timezone('utc', now()))
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Update any NULL edited_by rows to placeholder
  UPDATE public.attendance_audit_logs SET edited_by = placeholder WHERE edited_by IS NULL;
END;
$$;

-- Re-apply NOT NULL constraint only if currently nullable
DO $$
DECLARE is_nullable text;
BEGIN
  SELECT is_nullable INTO is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'attendance_audit_logs' AND column_name = 'edited_by';

  IF is_nullable = 'YES' THEN
    ALTER TABLE public.attendance_audit_logs ALTER COLUMN edited_by SET NOT NULL;
  END IF;
END;
$$;

COMMIT;
