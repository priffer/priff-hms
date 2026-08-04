// PHASE 13A step 1: List current Auth Users (read-only, safe) before creating any test accounts.
const { getConfig } = require('./lib/env');
const { PROJECT_URL, SERVICE_KEY } = getConfig();

async function main() {
  const resp = await fetch(`${PROJECT_URL}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const json = await resp.json();
  const users = json.users || [];
  console.log('total_users:', users.length);
  console.log(JSON.stringify(users.map(u => ({ id: u.id, email: u.email, created_at: u.created_at })), null, 2));
}
main();
