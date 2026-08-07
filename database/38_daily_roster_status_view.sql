-- =====================================================
-- database/38_daily_roster_status_view.sql
-- TV Dashboard follow-up: adds a "who should be working today" baseline so the
-- dashboard can show accurate มาทำงานทั้งหมด / ไม่มาทำงาน (absent) counts, instead
-- of comparing present-count against total active staff (which incorrectly counts
-- people on their scheduled weekly rest day as "absent").
--
-- Mirrors the same eligibility rule already used in v_attendance_absence_summary
-- (database/35_reporting_views_powerbi.sql) and fn_run_payroll_period()
-- (27_payroll_engine.sql): an employee is "expected to work" on a given day if they
-- have an employee_shift_assignments row covering that day, it's not a company
-- holiday, and it's not their weekly_rest_day.
--
-- Scoped to a rolling 16-day window (15 days back + 1 day forward, to absorb any
-- server/client timezone skew around midnight) rather than all-time, so the
-- generate_series cost stays bounded regardless of how long the company has been
-- using the system - this view is queried live by the TV dashboard on every refresh.
--
-- Read-only aggregation - no Payroll Engine calculation logic touched, no writes.
-- Idempotent: CREATE OR REPLACE VIEW.
-- =====================================================

CREATE OR REPLACE VIEW public.v_daily_roster_status AS
WITH recent_days AS (
  SELECT generate_series(CURRENT_DATE - INTERVAL '15 days', CURRENT_DATE + INTERVAL '1 day', INTERVAL '1 day')::date AS work_date
),
eligible AS (
  SELECT DISTINCT
    esa.company_id,
    d.work_date,
    esa.employee_id
  FROM recent_days d
  JOIN public.employee_shift_assignments esa
    ON esa.effective_from <= d.work_date AND (esa.effective_to IS NULL OR esa.effective_to >= d.work_date)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.company_holidays ch
    WHERE ch.company_id = esa.company_id AND ch.holiday_date = d.work_date
  )
  AND (esa.weekly_rest_day IS NULL OR esa.weekly_rest_day <> EXTRACT(DOW FROM d.work_date)::integer)
)
SELECT
  company_id,
  work_date,
  COUNT(DISTINCT employee_id) AS expected_count
FROM eligible
GROUP BY company_id, work_date;

COMMENT ON VIEW public.v_daily_roster_status IS
  'TV Dashboard: จำนวนพนักงานที่ควรมาทำงานในแต่ละวัน (มีกะผูกไว้ ไม่ใช่วันหยุดบริษัท/วันหยุดประจำสัปดาห์) - รอบ 16 วันล่าสุด ใช้เทียบกับ present_count เพื่อคำนวณคนขาดงานวันนี้แบบเรียลไทม์';

GRANT SELECT ON public.v_daily_roster_status TO authenticated;
