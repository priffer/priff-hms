// Shared .env loader (handles UTF-8 BOM and quoted values) + Supabase project URL helper.
// Used by all PHASE 13 scripts. Read-only helper - no side effects.
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  let raw = fs.readFileSync(envPath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // strip UTF-8 BOM
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) {
      let val = m[2];
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      process.env[m[1]] = val;
    }
  }
}

function projectUrlFromDatabaseUrl(databaseUrl) {
  const m = databaseUrl && databaseUrl.match(/@db\.([a-z0-9]+)\.supabase\.co/i);
  return m ? `https://${m[1]}.supabase.co` : null;
}

function getConfig() {
  loadEnv();
  const DATABASE_URL = process.env.DATABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const PROJECT_URL = projectUrlFromDatabaseUrl(DATABASE_URL || '');
  return { DATABASE_URL, SERVICE_KEY, ANON_KEY, PROJECT_URL };
}

module.exports = { loadEnv, projectUrlFromDatabaseUrl, getConfig };
