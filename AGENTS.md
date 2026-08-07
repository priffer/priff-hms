# AGENTS.md — PRIFF-HMS

This file exists so that **any** AI coding agent/model working on this repository
(GitHub Copilot, Cursor, Claude Code, Roo Code, Cline, OpenAI Codex CLI, etc.) follows
the same rules, regardless of which tool the owner is currently using.

## Read this first, always

**`.agent-rules.md`** (repo root) is the authoritative rules file for this project. Read
it in full before making any change. It covers:

- Payroll Engine calculation logic — requires explicit owner sign-off before any change
  (Thai labor law 2026 compliance; see `docs/payroll-architecture.md`)
- What the agent may do autonomously vs. what requires asking first
- Staging vs. Production environment rules (Supabase `hcyibcqojsyldiyzperr.supabase.co`
  is Staging; `main` branch auto-deploys to Production via Vercel)
- Test/demo data conventions (`DEMO*` accounts only, clean up temp data after use)
- **Token/credit efficiency rules** — this is the most load-bearing section for cost
  control, summarized below because it's easy to skip:

### Cost-control quick reference (full detail in `.agent-rules.md`)

1. **Verification hierarchy, cheapest-sufficient first:** SQL/Node script → 
   `node scripts/rest-check.js "<table>?<query>"` (proves Supabase REST/PostgREST
   behavior in one HTTP call) → full Playwright browser walkthrough (reserved for
   genuinely visual/UI-flow checks only). Do not reach for a full browser session to
   prove a backend/schema fact — this was a real, measured source of wasted spend.
2. **Migrations:** `node scripts/run-ess-migrations.js` tracks what's already applied
   and skips it automatically. Just run it normally; use `--only <file>` while
   iterating on one migration.
3. **Git/PR workflow:** this repo squash-merges every PR. Immediately after a PR
   merges, run `git fetch origin main && git reset --hard origin/main` on the branch
   *before* writing the next commit — do not layer new work on a branch whose earlier
   commits are already squashed into `main`.
4. **New chat threshold:** after every merged PR, proactively suggest starting a new
   chat for the next unit of work. If a single chat has produced 3+ merged PRs or
   exceeded ~50 user-visible turns, recommend a new chat even if the next task feels
   related — say so explicitly rather than deciding silently.
5. **Batch test scripts:** one script per test scenario (setup + verify + cleanup),
   not three separate scratch files.
6. Match verification depth/reporting detail to the actual risk of the change, not to
   a fixed maximum every time.

If your tool has its own separate instructions file (e.g. `.github/copilot-instructions.md`,
`.cursorrules`, `CLAUDE.md`), that file should point back here — do not fork the rules,
edit `.agent-rules.md` as the single source of truth and keep pointer files short.
