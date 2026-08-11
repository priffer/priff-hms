-- =====================================================
-- database/41_attendance_break_columns.sql
-- Attendance break metadata on attendance_logs
-- =====================================================

BEGIN;

ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS break_minutes integer,
  ADD COLUMN IF NOT EXISTS break_source text,
  ADD COLUMN IF NOT EXISTS break_updated_by uuid,
  ADD COLUMN IF NOT EXISTS break_updated_at timestamp with time zone;

ALTER TABLE public.attendance_logs
  DROP CONSTRAINT IF EXISTS attendance_logs_break_source_check;

ALTER TABLE public.attendance_logs
  ADD CONSTRAINT attendance_logs_break_source_check
  CHECK (break_source IS NULL OR break_source IN ('policy', 'manual'));

ALTER TABLE public.attendance_logs
  DROP CONSTRAINT IF EXISTS attendance_logs_break_minutes_check;

ALTER TABLE public.attendance_logs
  ADD CONSTRAINT attendance_logs_break_minutes_check
  CHECK (break_minutes IS NULL OR (break_minutes >= 0 AND break_minutes <= 1440));

COMMIT;

-- Verification
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'attendance_logs'
--   AND column_name IN ('break_minutes', 'break_source', 'break_updated_by', 'break_updated_at');
