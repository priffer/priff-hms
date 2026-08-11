-- =====================================================
-- database/47_payroll_runs_one_draft_per_period.sql
--
-- 1) Staging cleanup of duplicate/empty draft payroll_runs (approved 2026-08-11)
-- 2) Partial unique index: at most one draft run per period_id
--
-- period_id is the UUID PK of payroll_periods (globally unique), so indexing
-- (period_id) WHERE status='draft' is sufficient without company_id.
--
-- -----------------------------------------------------------------
-- DELETE TRAIL (Staging cleanup, 2026-08-11 Asia/Bangkok session)
-- -----------------------------------------------------------------
-- A) period 2026-08-09 (6099201a-3715-485c-bdce-8dc52ba67667) — all draft 0.00:
--    - f72f783d-ca58-4ee3-ad5a-f489d799746e  created 2026-08-09 04:28 UTC  lines=0
--    - 2ea40048-5f34-491f-aafe-faf7f4dff539  created 2026-08-09 07:51 UTC  lines=0
--    - 7f78b419-94aa-43e5-9a12-5af94144eb00  created 2026-08-11 10:54 UTC  lines=1 DEMOPAY001 gross=0
-- B) period 2026-08-11 (a7730b6a-4e97-42e0-9258-6bcd431dee09) — duplicate draft:
--    - 21ec9e02-ac31-4dab-8390-93dd93e5fc07  created 2026-08-11 10:52 UTC  712.5/682.5  (DELETED)
--    - 85c197a1-c206-49cf-a677-af7d932c8aeb  created 2026-08-11 10:57 UTC  712.5/682.5  (KEPT / reused)
-- Idempotent: DELETE ... WHERE id IN (...) is a no-op if rows already gone (e.g. Production).
-- =====================================================

BEGIN;

-- Reverse YTD contributed by doomed draft runs (esp. the duplicate 712.5 run)
WITH doomed AS (
  SELECT unnest(ARRAY[
    'f72f783d-ca58-4ee3-ad5a-f489d799746e'::uuid,
    '2ea40048-5f34-491f-aafe-faf7f4dff539'::uuid,
    '7f78b419-94aa-43e5-9a12-5af94144eb00'::uuid,
    '21ec9e02-ac31-4dab-8390-93dd93e5fc07'::uuid
  ]) AS run_id
),
sums AS (
  SELECT l.employee_id, l.company_id,
         EXTRACT(YEAR FROM COALESCE(r.run_date, r.created_at))::integer AS tax_year,
         COALESCE(SUM(l.gross_pay), 0) AS gross_pay,
         COALESCE(SUM(l.social_security_employee), 0) AS ss,
         COALESCE(SUM(l.withholding_tax), 0) AS tax
  FROM public.payroll_lines l
  JOIN public.payroll_runs r ON r.id = l.payroll_run_id
  JOIN doomed d ON d.run_id = l.payroll_run_id
  GROUP BY l.employee_id, l.company_id, EXTRACT(YEAR FROM COALESCE(r.run_date, r.created_at))
)
UPDATE public.payroll_ytd_summary y SET
  ytd_income = GREATEST(COALESCE(y.ytd_income, 0) - s.gross_pay, 0),
  ytd_social_security = GREATEST(COALESCE(y.ytd_social_security, 0) - s.ss, 0),
  ytd_tax_paid = GREATEST(COALESCE(y.ytd_tax_paid, 0) - s.tax, 0),
  updated_at = timezone('utc'::text, now())
FROM sums s
WHERE y.employee_id = s.employee_id
  AND y.company_id = s.company_id
  AND y.tax_year = s.tax_year;

-- Reset advances that pointed at runs being removed (safe if none)
UPDATE public.advance_payments
SET
  status = CASE WHEN status = 'paid' THEN 'approved' ELSE status END,
  deducted_amount = 0,
  deducted_in_payroll_run_id = NULL
WHERE deducted_in_payroll_run_id IN (
  'f72f783d-ca58-4ee3-ad5a-f489d799746e'::uuid,
  '2ea40048-5f34-491f-aafe-faf7f4dff539'::uuid,
  '7f78b419-94aa-43e5-9a12-5af94144eb00'::uuid,
  '21ec9e02-ac31-4dab-8390-93dd93e5fc07'::uuid
);

-- Child records first, then payroll_runs — single transaction
WITH doomed AS (
  SELECT unnest(ARRAY[
    'f72f783d-ca58-4ee3-ad5a-f489d799746e'::uuid,
    '2ea40048-5f34-491f-aafe-faf7f4dff539'::uuid,
    '7f78b419-94aa-43e5-9a12-5af94144eb00'::uuid,
    '21ec9e02-ac31-4dab-8390-93dd93e5fc07'::uuid
  ]) AS run_id
),
del_payslips AS (
  DELETE FROM public.payroll_payslips p
  USING doomed d
  WHERE p.payroll_run_id = d.run_id
  RETURNING p.id
),
del_details AS (
  DELETE FROM public.payroll_line_details dtl
  USING public.payroll_lines l
  JOIN doomed d ON d.run_id = l.payroll_run_id
  WHERE dtl.payroll_line_id = l.id
  RETURNING dtl.id
),
del_lines AS (
  DELETE FROM public.payroll_lines l
  USING doomed d
  WHERE l.payroll_run_id = d.run_id
  RETURNING l.id
)
DELETE FROM public.payroll_runs r
USING doomed d
WHERE r.id = d.run_id
  AND r.status = 'draft';

-- One draft run per period (never constrains approved/locked/etc.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_runs_one_draft_per_period
  ON public.payroll_runs (period_id)
  WHERE status = 'draft';

COMMIT;

-- Verification
-- SELECT period_id, COUNT(*) FROM public.payroll_runs WHERE status='draft' GROUP BY period_id HAVING COUNT(*) > 1;
-- SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'idx_payroll_runs_one_draft_per_period';
