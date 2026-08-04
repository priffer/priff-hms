// PHASE 13A step 5: Real login via Supabase Auth (GoTrue password grant) using the ANON key.
// This exercises the exact same login path js/auth/login.js uses in the browser.
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./lib/env');
const { PROJECT_URL, ANON_KEY } = getConfig();

const accounts = JSON.parse(fs.readFileSync(path.join(__dirname, 'p13-test-accounts-result.json'), 'utf8'));

async function login(email, password) {
  const resp = await fetch(`${PROJECT_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const json = await resp.json();
  return { ok: resp.ok, status: resp.status, body: json };
}

async function main() {
  const sessions = [];
  for (const acct of accounts) {
    if (!acct.password) {
      sessions.push({ role: acct.role, email: acct.email, status: 'SKIPPED_NO_PASSWORD_ON_RECORD' });
      continue;
    }
    const result = await login(acct.email, acct.password);
    if (result.ok && result.body.access_token) {
      sessions.push({
        role: acct.role,
        email: acct.email,
        auth_uid: result.body.user && result.body.user.id,
        access_token: result.body.access_token,
        status: 'LOGIN_SUCCESS',
      });
    } else {
      sessions.push({ role: acct.role, email: acct.email, status: 'LOGIN_FAILED', error: result.body });
    }
  }
  // Print only status summary (avoid dumping raw JWTs to console/log noise)
  console.log(JSON.stringify(sessions.map(s => ({ role: s.role, email: s.email, status: s.status, auth_uid: s.auth_uid })), null, 2));
  fs.writeFileSync(path.join(__dirname, 'p13-sessions-result.json'), JSON.stringify(sessions, null, 2));
}
main();
