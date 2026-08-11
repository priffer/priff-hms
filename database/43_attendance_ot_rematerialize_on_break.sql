-- Migration 43: Rematerialize OT when break fields change
--
-- Bug: trg_attendance_log_materialize_ot only fired on UPDATE OF
-- total_hours, check_in, check_out. Admin break-only edits update
-- break_minutes / break_source; the BEFORE trigger then rewrites
-- total_hours, but Postgres does NOT fire UPDATE OF total_hours for
-- columns changed only inside a BEFORE trigger. Result: net hours
-- change while attendance_ot_details stay stale.
--
-- Fix: include break_minutes and break_source in the trigger column list.

BEGIN;

DROP TRIGGER IF EXISTS trg_attendance_log_materialize_ot ON public.attendance_logs;
CREATE TRIGGER trg_attendance_log_materialize_ot
AFTER INSERT OR UPDATE OF total_hours, check_in, check_out, break_minutes, break_source
ON public.attendance_logs
FOR EACH ROW
EXECUTE FUNCTION public.fn_trg_attendance_log_materialize_ot();

COMMIT;

-- Verification
-- SELECT event_object_table, trigger_name, action_timing, event_manipulation, action_statement
-- FROM information_schema.triggers
-- WHERE trigger_name = 'trg_attendance_log_materialize_ot';
