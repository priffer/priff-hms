// PHASE 13A step 3: Map real auth_uid (from newly created QA accounts) onto ONE
// canonical user_profiles row per role for company_id = 'comp_kc_clean'.
//
// Rationale for "canonical" choice: duplicate user_profiles rows exist per role
// (documented in docs/authenticated-rls-test-plan.md Section 6 - Data Integrity
// Findings) from earlier non-idempotent seed runs. Since auth_uid has a UNIQUE
// constraint, only ONE row per role can be mapped. RLS policies for these tables
// key off `emp_id` (text) / `role` / `company_id` / `get_user_profile_id()`, which
// are identical across the duplicate rows for a given role, so the choice of which
// duplicate becomes canonical does not affect RLS test correctness. We deterministically
// pick the row with the smallest `id` (UUID) per role.
//
// This script is idempotent: if a role's canonical profile is already mapped to the
// correct auth_uid, it is a no-op.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { getConfig } = require('./lib/env');
const { DATABASE_URL } = getConfig();

const resultPath = path.join(__dirname, 'p13-test-accounts-result.json');
const accounts = JSON.parse(fs.readFileSync(resultPath, 'utf8'));

async function main() {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();
  const mapping = [];
  try {
    for (const acct of accounts) {
      if (!acct.auth_uid) {
        mapping.push({ role: acct.role, status: 'SKIPPED_NO_AUTH_UID' });
        continue;
      }
      // Pick canonical profile: smallest id for this role/company
      const { rows: canonicalRows } = await c.query(
        `SELECT id, auth_uid FROM public.user_profiles
         WHERE company_id = 'comp_kc_clean' AND role = $1
         ORDER BY id ASC LIMIT 1;`,
        [acct.role]
      );
      if (canonicalRows.length === 0) {
        mapping.push({ role: acct.role, status: 'NO_PROFILE_FOUND' });
        continue;
      }
      const profile = canonicalRows[0];
      if (profile.auth_uid === acct.auth_uid) {
        mapping.push({ role: acct.role, profile_id: profile.id, status: 'ALREADY_MAPPED' });
        continue;
      }
      await c.query(
        `UPDATE public.user_profiles SET auth_uid = $1, updated_at = now() WHERE id = $2;`,
        [acct.auth_uid, profile.id]
      );
      mapping.push({
        role: acct.role,
        profile_id: profile.id,
        old_auth_uid: profile.auth_uid,
        new_auth_uid: acct.auth_uid,
        status: 'MAPPED',
      });
    }
    console.log(JSON.stringify(mapping, null, 2));
    fs.writeFileSync(path.join(__dirname, 'p13-mapping-result.json'), JSON.stringify(mapping, null, 2));
  } finally {
    await c.end();
  }
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
