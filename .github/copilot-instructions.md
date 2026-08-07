# GitHub Copilot instructions — PRIFF-HMS

Read **`.agent-rules.md`** (repo root) in full before making any change — it is the
authoritative rules file for this repository and applies to every AI coding tool used
on this project, not just Copilot. `AGENTS.md` has a short cross-tool summary if you
need the quick version, but `.agent-rules.md` is the source of truth.

Highlights most relevant to Copilot's agent mode specifically:

- **Prefer the cheapest sufficient verification method.** For anything about data,
  schema, RLS, or Supabase REST/PostgREST behavior (e.g. "Could not find a
  relationship... in the schema cache" style errors), use a direct SQL query or
  `node scripts/rest-check.js "<table>?<query>"` instead of opening a full browser
  session. Reserve Playwright/browser automation for checks that are genuinely about
  visual UI or click-through flow.
- **Migrations run via `node scripts/run-ess-migrations.js`** — it now tracks applied
  files and skips them automatically, so just run it normally rather than assuming a
  full re-run every time.
- **This repo squash-merges PRs.** After a PR merges, run
  `git fetch origin main && git reset --hard origin/main` before your next commit.
- **Suggest a new chat after each merged PR**, or once a single chat has produced 3+
  merged PRs / ~50+ turns, per the thresholds in `.agent-rules.md`.
- **Payroll calculation logic requires explicit owner sign-off** before any change —
  see `.agent-rules.md` for the full list of what needs approval vs. what doesn't.
