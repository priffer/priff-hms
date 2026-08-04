// PHASE 12A - Supabase Admin API capability probe (READ-ONLY / NON-DESTRUCTIVE)
// This script NEVER creates, updates, or deletes a real user.
// - "List" is tested for real (safe, read-only).
// - "Create" is probed with an intentionally invalid payload so that, if authorization
//   succeeds, GoTrue rejects it at the validation stage (400/422) instead of creating
//   a user. A 401/403 instead indicates the key lacks admin rights.
// - "Update" and "Delete" are probed against a random, non-existent user id
//   (00000000-0000-0000-0000-000000000000). A 404 means the request was authorized
//   and reached the lookup layer (capability confirmed) without touching real data.
//   A 401/403 means the key lacks admin rights.

const fs = require('fs');

function loadEnvFallback() {
  // In case dotenv didn't pick it up for any reason, parse .env manually.
  if (process.env.DATABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const envPath = require('path').join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  let raw = fs.readFileSync(envPath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // strip UTF-8 BOM
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) {
      let val = m[2];
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  }
}
loadEnvFallback();

const DATABASE_URL = process.env.DATABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function deriveProjectUrl(databaseUrl) {
  // db.<ref>.supabase.co -> https://<ref>.supabase.co
  const m = databaseUrl && databaseUrl.match(/@db\.([a-z0-9]+)\.supabase\.co/i);
  if (!m) return null;
  return `https://${m[1]}.supabase.co`;
}

const PROJECT_URL = deriveProjectUrl(DATABASE_URL || '');

const results = {
  timestamp: new Date().toISOString(),
  project_url: PROJECT_URL,
  service_key_present: !!SERVICE_KEY,
  service_key_prefix: SERVICE_KEY ? SERVICE_KEY.slice(0, 12) + '...' : null,
  checks: {},
};

async function callAdmin(method, path, body) {
  const url = `${PROJECT_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
  };
  try {
    const resp = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try {
      json = await resp.json();
    } catch (e) {
      json = null;
    }
    return { ok: resp.ok, status: resp.status, body: json };
  } catch (err) {
    return { ok: false, status: null, error: err.message };
  }
}

async function main() {
  if (!PROJECT_URL) {
    results.error = 'Could not derive Supabase project URL from DATABASE_URL host.';
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  if (!SERVICE_KEY) {
    results.error = 'SUPABASE_SERVICE_ROLE_KEY missing from environment.';
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  // 1) LIST USERS (real, read-only, safe)
  const list = await callAdmin('GET', '/auth/v1/admin/users?page=1&per_page=1');
  results.checks.list_users = {
    status: list.status,
    ok: list.ok,
    capability: list.ok ? 'CONFIRMED' : (list.status === 401 || list.status === 403 ? 'DENIED' : 'UNKNOWN'),
    sample_error: list.ok ? null : (list.body || list.error),
    user_count_returned: list.ok && list.body && Array.isArray(list.body.users) ? list.body.users.length : null,
  };

  // 2) CREATE USER PROBE (intentionally invalid payload - no email/password combo that GoTrue accepts)
  // We send an obviously invalid email format so validation fails BEFORE any user would be created.
  const createProbe = await callAdmin('POST', '/auth/v1/admin/users', {
    email: 'not-a-valid-email-probe-phase12a',
    email_confirm: true,
  });
  results.checks.create_user = {
    status: createProbe.status,
    ok: createProbe.ok,
    // If ok===true it would mean a user got created (unexpected/undesired) - flag loudly.
    capability: createProbe.status === 401 || createProbe.status === 403
      ? 'DENIED'
      : (createProbe.status === 400 || createProbe.status === 422
        ? 'CONFIRMED (validation-rejected, no user created)'
        : (createProbe.ok ? 'DANGER_USER_MAY_HAVE_BEEN_CREATED' : 'UNKNOWN')),
    response: createProbe.body || createProbe.error,
  };

  // If by some chance a user actually got created because GoTrue accepted the bad email,
  // we must detect and report it (and NOT silently delete it, since deletion is out of scope
  // without explicit approval - we just flag it clearly for human follow-up).
  if (createProbe.ok && createProbe.body && createProbe.body.id) {
    results.checks.create_user.created_user_id_FLAG_FOR_HUMAN_REVIEW = createProbe.body.id;
  }

  // 3) UPDATE USER PROBE (non-existent id, safe)
  const fakeId = '00000000-0000-0000-0000-000000000000';
  const updateProbe = await callAdmin('PUT', `/auth/v1/admin/users/${fakeId}`, {
    user_metadata: { probe: 'phase12a' },
  });
  results.checks.update_user = {
    status: updateProbe.status,
    ok: updateProbe.ok,
    capability: updateProbe.status === 401 || updateProbe.status === 403
      ? 'DENIED'
      : (updateProbe.status === 404 ? 'CONFIRMED (authorized, target not found)' : 'UNKNOWN'),
    response: updateProbe.body || updateProbe.error,
  };

  // 4) DELETE USER PROBE (non-existent id, safe - permission check only)
  const deleteProbe = await callAdmin('DELETE', `/auth/v1/admin/users/${fakeId}`);
  results.checks.delete_user = {
    status: deleteProbe.status,
    ok: deleteProbe.ok,
    capability: deleteProbe.status === 401 || deleteProbe.status === 403
      ? 'DENIED'
      : (deleteProbe.status === 404 ? 'CONFIRMED (authorized, target not found)' : 'UNKNOWN'),
    response: deleteProbe.body || deleteProbe.error,
  };

  console.log(JSON.stringify(results, null, 2));
  fs.writeFileSync(
    require('path').join(__dirname, 'supabase-admin-capability-result.json'),
    JSON.stringify(results, null, 2)
  );
}

main();
