// PHASE 13A CRITICAL FINDING VERIFICATION: confirm that the ANON key alone (i.e. an
// unauthenticated visitor with zero login) can read attendance_logs / employees due to
// legacy "Allow public ..." policies with USING(true) for role `public`.
// This is a READ-ONLY GET request - no data is modified.
const { getConfig } = require('./lib/env');
const { PROJECT_URL, ANON_KEY } = getConfig();

async function anonGet(queryPath) {
  const resp = await fetch(`${PROJECT_URL}/rest/v1/${queryPath}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }, // no user session at all
  });
  let body;
  try { body = await resp.json(); } catch (e) { body = await resp.text(); }
  return { status: resp.status, rowCount: Array.isArray(body) ? body.length : null, body };
}

async function main() {
  console.log('--- Unauthenticated (anon key only) GET /rest/v1/attendance_logs ---');
  console.log(JSON.stringify(await anonGet('attendance_logs?select=id,emp_id,company_id'), null, 2));

  console.log('--- Unauthenticated (anon key only) GET /rest/v1/employees ---');
  console.log(JSON.stringify(await anonGet('employees?select=id,emp_id,company_id'), null, 2));

  console.log('--- Unauthenticated (anon key only) GET /rest/v1/user_profiles ---');
  console.log(JSON.stringify(await anonGet('user_profiles?select=id,role,email,company_id'), null, 2));
}
main();
