// PHASE 13A step 2: Create QA test accounts via Supabase Admin API (idempotent - skips if exists).
// Generates a random secure temporary password per account and writes results to
// scripts/p13-test-accounts-result.json (used later to populate docs/test-accounts.md).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./lib/env');
const { PROJECT_URL, SERVICE_KEY } = getConfig();

const QA_ACCOUNTS = [
  { email: 'qa-admin@kc-clean.internal', role: 'admin' },
  { email: 'qa-payroll@kc-clean.internal', role: 'payroll' },
  { email: 'qa-supervisor@kc-clean.internal', role: 'supervisor' },
  { email: 'qa-employee@kc-clean.internal', role: 'employee' },
];

function randomPassword() {
  // 20 chars, mixed alnum + symbols, cryptographically random
  const bytes = crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, '');
  return `Qa!${bytes.slice(0, 14)}9x`;
}

async function listAllUsers() {
  const resp = await fetch(`${PROJECT_URL}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const json = await resp.json();
  return json.users || [];
}

async function createUser(email, password) {
  const resp = await fetch(`${PROJECT_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const json = await resp.json();
  return { ok: resp.ok, status: resp.status, body: json };
}

async function main() {
  const existing = await listAllUsers();
  const results = [];

  for (const acct of QA_ACCOUNTS) {
    const found = existing.find(u => u.email === acct.email);
    if (found) {
      results.push({ email: acct.email, role: acct.role, auth_uid: found.id, action: 'ALREADY_EXISTS', password: null });
      continue;
    }
    const password = randomPassword();
    const created = await createUser(acct.email, password);
    if (created.ok && created.body && created.body.id) {
      results.push({ email: acct.email, role: acct.role, auth_uid: created.body.id, action: 'CREATED', password });
    } else {
      results.push({ email: acct.email, role: acct.role, auth_uid: null, action: 'FAILED', error: created.body || created.status });
    }
  }

  console.log(JSON.stringify(results, null, 2));
  fs.writeFileSync(
    path.join(__dirname, 'p13-test-accounts-result.json'),
    JSON.stringify(results, null, 2)
  );
}

main();
