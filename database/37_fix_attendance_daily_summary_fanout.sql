-- =====================================================
-- database/37_fix_attendance_daily_summary_fanout.sql
-- Phase 4 follow-up bugfix: v_attendance_daily_summary double-counts
-- present_count / late_count / total_hours_worked whenever an attendance_log
-- has more than one attendance_ot_details row (one row per ot_type: ot15/ot2/ot3).
--
-- Root cause: the original view (database/35_reporting_views_powerbi.sql) does
--   LEFT JOIN attendance_ot_details aod ON aod.attendance_log_id = al.id
-- which fans out attendance_logs rows 1:N when an employee has multiple OT
-- types on the same day, inflating COUNT(*)/SUM(al.total_hours) for that day.
-- (ot_employee_count/total_ot_hours were already correct because they used
-- COUNT(DISTINCT ...) / SUM(aod.ot_hours) respectively.)
--
-- Fix: pre-aggregate attendance_ot_details per attendance_log_id ONLY (not also
-- by employee_id - a stray/mismatched aod.employee_id on one row must not
-- re-introduce fan-out) in a subquery before joining, so the join back to
-- attendance_logs is 1:1 (or 1:0). ot_employee_count uses al.employee_id (the
-- attendance_logs row's own employee) rather than aod.employee_id, since that
-- is the reliable source of "which employee this attendance day belongs to".
--
-- Read-only reporting view - no Payroll Engine calculation logic touched.
-- Idempotent: CREATE OR REPLACE VIEW.
-- =====================================================

CREATE OR REPLACE VIEW public.v_attendance_daily_summary AS
SELECT
  al.company_id,
  al.work_date,
  al.client_id,
  c.client_name,
  COUNT(*) AS present_count,
  COUNT(*) FILTER (WHERE al.is_late IS TRUE) AS late_count,
  COUNT(*) FILTER (WHERE al.is_late IS NOT NULL) AS late_resolved_count,
  COUNT(*) FILTER (WHERE al.is_late IS NULL) AS late_unresolved_count,
  COUNT(DISTINCT al.employee_id) FILTER (WHERE aod.attendance_log_id IS NOT NULL) AS ot_employee_count,
  COALESCE(SUM(al.total_hours), 0) AS total_hours_worked,
  COALESCE(SUM(aod.total_ot_hours), 0) AS total_ot_hours
FROM public.attendance_logs al
LEFT JOIN public.clients c ON c.id = al.client_id
LEFT JOIN (
  SELECT attendance_log_id, SUM(ot_hours) AS total_ot_hours
  FROM public.attendance_ot_details
  GROUP BY attendance_log_id
) aod ON aod.attendance_log_id = al.id
GROUP BY al.company_id, al.work_date, al.client_id, c.client_name;

COMMENT ON VIEW public.v_attendance_daily_summary IS
  'Phase 4 reporting: ภาพรวมมาทำงาน/มาสาย/OT รายวันแยกไซต์ (สำหรับ dashboard + Power BI). Fixed in 37_*: pre-aggregate attendance_ot_details by attendance_log_id only (not employee_id) before join, to avoid fan-out double counting present_count/late_count/total_hours_worked when a log has multiple OT rows (including any with a mismatched employee_id).';
