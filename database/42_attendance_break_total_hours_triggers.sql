-- =====================================================
-- database/42_attendance_break_total_hours_triggers.sql
-- Auto break policy + total_hours calculation
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_attendance_duration_hours(
  p_check_in time,
  p_check_out time
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_minutes integer;
BEGIN
  IF p_check_in IS NULL OR p_check_out IS NULL THEN
    RETURN NULL;
  END IF;

  v_minutes := CASE
    WHEN p_check_out >= p_check_in
      THEN ROUND(EXTRACT(EPOCH FROM (p_check_out - p_check_in)) / 60.0)::integer
    ELSE
      ROUND(EXTRACT(EPOCH FROM ((p_check_out + interval '24 hours') - p_check_in)) / 60.0)::integer
  END;

  RETURN ROUND(v_minutes / 60.0, 4);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_break_policy_for_company(
  p_company_id text
)
RETURNS TABLE (
  auto_break_threshold_hours numeric,
  auto_break_minutes integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(bps.auto_break_threshold_hours, 6) AS auto_break_threshold_hours,
    COALESCE(bps.auto_break_minutes, 60) AS auto_break_minutes
  FROM public.break_policy_settings bps
  WHERE bps.company_id = p_company_id

  UNION ALL

  SELECT 6, 60
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.break_policy_settings bps2
    WHERE bps2.company_id = p_company_id
  )

  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_attendance_apply_break_policy(
  p_row public.attendance_logs
)
RETURNS public.attendance_logs
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.attendance_logs;
  v_duration_hours numeric;
  v_policy record;
BEGIN
  v_row := p_row;

  -- Manual override is authoritative until an admin explicitly switches the source back.
  IF v_row.break_source = 'manual' THEN
    RETURN v_row;
  END IF;

  -- Incomplete rows keep NULL break metadata so they remain visibly unresolved.
  IF v_row.check_in IS NULL OR v_row.check_out IS NULL THEN
    v_row.break_minutes := NULL;
    v_row.break_source := NULL;
    v_row.break_updated_by := NULL;
    v_row.break_updated_at := NULL;
    RETURN v_row;
  END IF;

  v_duration_hours := public.fn_attendance_duration_hours(v_row.check_in, v_row.check_out);

  SELECT *
  INTO v_policy
  FROM public.fn_get_break_policy_for_company(v_row.company_id);

  IF v_duration_hours > v_policy.auto_break_threshold_hours THEN
    v_row.break_minutes := v_policy.auto_break_minutes;
  ELSE
    v_row.break_minutes := 0;
  END IF;

  v_row.break_source := 'policy';
  v_row.break_updated_by := NULL;
  v_row.break_updated_at := timezone('utc'::text, now());

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_attendance_compute_total_hours(
  p_row public.attendance_logs
)
RETURNS public.attendance_logs
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_row public.attendance_logs;
  v_duration_hours numeric;
BEGIN
  v_row := p_row;

  IF v_row.check_in IS NULL OR v_row.check_out IS NULL THEN
    v_row.total_hours := NULL;
    RETURN v_row;
  END IF;

  v_duration_hours := public.fn_attendance_duration_hours(v_row.check_in, v_row.check_out);

  v_row.total_hours := ROUND(
    GREATEST(v_duration_hours - (COALESCE(v_row.break_minutes, 0) / 60.0), 0),
    4
  );

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_trg_attendance_break_and_total_hours()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_break_changed boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_break_changed :=
      NEW.break_minutes IS DISTINCT FROM OLD.break_minutes
      OR NEW.break_source IS DISTINCT FROM OLD.break_source;
  END IF;

  -- Stamp manual edits once, but do not mutate manual values afterward.
  IF NEW.break_source = 'manual' AND (
       TG_OP = 'INSERT'
       OR v_break_changed
     ) THEN
    NEW.break_updated_at := timezone('utc'::text, now());

    -- Matches the ot_policy_settings.updated_by pattern: plain uuid, no FK.
    IF NEW.break_updated_by IS NULL THEN
      NEW.break_updated_by := public.get_user_profile_id();
    END IF;
  END IF;

  NEW := public.fn_attendance_apply_break_policy(NEW);
  NEW := public.fn_attendance_compute_total_hours(NEW);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_break_and_total_hours ON public.attendance_logs;

CREATE TRIGGER trg_attendance_break_and_total_hours
BEFORE INSERT OR UPDATE OF
  check_in,
  check_out,
  company_id,
  break_minutes,
  break_source,
  break_updated_by
ON public.attendance_logs
FOR EACH ROW
EXECUTE FUNCTION public.fn_trg_attendance_break_and_total_hours();

COMMIT;

-- Verification
-- SELECT proname
-- FROM pg_proc
-- WHERE proname IN (
--   'fn_attendance_duration_hours',
--   'fn_get_break_policy_for_company',
--   'fn_attendance_apply_break_policy',
--   'fn_attendance_compute_total_hours',
--   'fn_trg_attendance_break_and_total_hours'
-- );
