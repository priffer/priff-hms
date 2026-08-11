# Staging cleanup trail — duplicate/empty draft payroll_runs

Date: 2026-08-11 (Asia/Bangkok session)  
Applied via: `database/47_payroll_runs_one_draft_per_period.sql`

## Deleted run_ids

### A) period `6099201a-3715-485c-bdce-8dc52ba67667` (daily 2026-08-09)

| run_id | created_at (UTC) | notes |
|--------|------------------|-------|
| `f72f783d-ca58-4ee3-ad5a-f489d799746e` | 2026-08-09 04:28 | draft 0.00, 0 lines |
| `2ea40048-5f34-491f-aafe-faf7f4dff539` | 2026-08-09 07:51 | draft 0.00, 0 lines |
| `7f78b419-94aa-43e5-9a12-5af94144eb00` | 2026-08-11 10:54 | draft 0.00, 1× DEMOPAY001 |

### B) period `a7730b6a-4e97-42e0-9258-6bcd431dee09` (daily 2026-08-11)

| run_id | created_at (UTC) | action |
|--------|------------------|--------|
| `21ec9e02-ac31-4dab-8390-93dd93e5fc07` | 2026-08-11 10:52 | **deleted** (older duplicate 712.5/682.5) |
| `85c197a1-c206-49cf-a677-af7d932c8aeb` | 2026-08-11 10:57 | **kept** (reuse target) |

## Also created

Partial unique index `idx_payroll_runs_one_draft_per_period` on `(period_id) WHERE status = 'draft'`.
