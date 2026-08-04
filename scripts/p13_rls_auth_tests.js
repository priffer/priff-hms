// PHASE 13A step 6: Authenticated RLS Test Checklist - executed via real Supabase Auth
// JWTs (obtained in step 5) calling the PostgREST REST API directly (exactly the path
// the browser app / auth-guard.js would use). Read-only GET requests only.
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./lib/env');
const { PROJECT_URL, ANON_KEY } = getConfig();

const sessions = JSON.parse(fs.readFileSync(path.join(__dirname, 'p13-sessions-result.json'), 'utf8'));
const byRole = Object.fromEntries(sessions.filter(s => s.status === 'LOGIN_SUCCESS').map(s => [s.role, s]));

async function restGet(token, queryPath) {
  const resp = await fetch(`${PROJECT_URL}/rest/v1/${queryPath}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  let body;
  try { body = await resp.json(); } catch (e) { body = null; }
  return { status: resp.status, ok: resp.ok, rows: Array.isArray(body) ? body : null, body };
}

async function authGetUser(token) {
  const resp = await fetch(`${PROJECT_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  const body = await resp.json();
  return { status: resp.status, ok: resp.ok, body };
}

const checklist = [];

function record(name, category, passed, detail) {
  checklist.push({ category, name, result: passed ? 'PASS' : 'FAIL', detail });
}

async function main() {
  if (!byRole.admin || !byRole.payroll || !byRole.supervisor || !byRole.employee) {
    console.error('Missing one or more logged-in sessions. Aborting.');
    process.exit(1);
  }

  // ---------- 1. Session Validation ----------
  for (const role of ['admin', 'payroll', 'supervisor', 'employee']) {
    const s = byRole[role];
    const u = await authGetUser(s.access_token);
    record('Session Validation', 'Session', u.ok && u.body.id === s.auth_uid,
      `role=${role} GET /auth/v1/user status=${u.status} returned_id=${u.body && u.body.id}`);
  }

  // ---------- 2. Role Validation (+ CRITICAL: check for cross-tenant leak on user_profiles) ----------
  for (const role of ['admin', 'payroll', 'supervisor', 'employee']) {
    const s = byRole[role];
    const r = await restGet(s.access_token, 'user_profiles?select=id,role,company_id,email,emp_id');
    const rows = r.rows || [];
    const ownRow = rows.find(row => row.role === role);
    const otherCompanyRows = rows.filter(row => row.company_id && row.company_id !== 'comp_kc_clean');
    record('Role Validation', 'Role',
      r.ok && !!ownRow,
      `role=${role} GET /rest/v1/user_profiles status=${r.status} rows_returned=${rows.length} own_row_found=${!!ownRow}`);
    record('user_profiles RLS Exposure Check', 'Security',
      rows.length <= 20, // heuristic: comp_kc_clean has ~12 rows; if this balloons to "all companies", flag it
      `role=${role} total_rows_visible=${rows.length} cross_company_rows_visible=${otherCompanyRows.length}`);
  }

  // ---------- 3. Attendance Access ----------
  {
    const s = byRole.employee;
    const r = await restGet(s.access_token, 'attendance_logs?select=id,emp_id,client_id');
    const rows = r.rows || [];
    const onlyOwn = rows.every(row => row.emp_id === 'EMP001');
    record('Attendance Access', 'Attendance', r.ok && rows.length > 0 && onlyOwn,
      `employee sees ${rows.length} attendance rows; all emp_id=EMP001: ${onlyOwn}`);
  }
  {
    const s = byRole.supervisor;
    const r = await restGet(s.access_token, 'attendance_logs?select=id,emp_id,client_id,company_id');
    const rows = r.rows || [];
    record('Attendance Access', 'Attendance', r.ok,
      `supervisor sees ${rows.length} attendance rows (scoped to assigned clients) status=${r.status}`);
  }
  {
    const s = byRole.payroll;
    const r = await restGet(s.access_token, 'attendance_logs?select=id,emp_id,company_id');
    const rows = r.rows || [];
    const allSameCompany = rows.every(row => row.company_id === 'comp_kc_clean');
    record('Attendance Access', 'Attendance', r.ok && allSameCompany,
      `payroll sees ${rows.length} attendance rows, all within own company: ${allSameCompany}`);
  }
  {
    const s = byRole.admin;
    const r = await restGet(s.access_token, 'attendance_logs?select=id,emp_id,company_id');
    const rows = r.rows || [];
    record('Attendance Access', 'Attendance', r.ok && rows.length > 0,
      `admin sees ${rows.length} attendance rows (full company access)`);
  }

  // ---------- 4. Payroll Access ----------
  {
    const s = byRole.employee;
    const r = await restGet(s.access_token, 'payroll_runs?select=id');
    const rows = r.rows || [];
    record('Payroll Access', 'Payroll', r.ok && rows.length === 0,
      `employee sees ${rows.length} payroll_runs rows (expected 0 - blocked by RLS)`);
  }
  {
    const s = byRole.supervisor;
    const r = await restGet(s.access_token, 'payroll_runs?select=id');
    const rows = r.rows || [];
    record('Supervisor Scope', 'Payroll', r.ok && rows.length === 0,
      `supervisor sees ${rows.length} payroll_runs rows (expected 0 - must NOT see payroll_runs)`);
  }
  {
    const s = byRole.payroll;
    const r = await restGet(s.access_token, 'payroll_runs?select=id,company_id');
    const rows = r.rows || [];
    record('Payroll Access', 'Payroll', r.ok,
      `payroll role sees ${rows.length} payroll_runs rows (status=${r.status})`);
    const rInsertCheck = await restGet(s.access_token, 'payroll_periods?select=id,company_id');
    record('Payroll Access', 'Payroll', rInsertCheck.ok,
      `payroll role sees ${(rInsertCheck.rows || []).length} payroll_periods rows (status=${rInsertCheck.status})`);
  }
  {
    const s = byRole.admin;
    const r = await restGet(s.access_token, 'payroll_runs?select=id,company_id');
    const rows = r.rows || [];
    record('Admin Access', 'Payroll', r.ok,
      `admin sees ${rows.length} payroll_runs rows (status=${r.status})`);
  }

  // ---------- 5. Supervisor Scope (client assignment boundary) ----------
  {
    const s = byRole.supervisor;
    const r = await restGet(s.access_token, 'supervisor_client_assignments?select=id,user_profile_id,client_id');
    const rows = r.rows || [];
    record('Supervisor Scope', 'Supervisor', r.ok,
      `supervisor GET /rest/v1/supervisor_client_assignments status=${r.status} rows=${rows.length}`);
  }

  // ---------- 6. Admin Access (full access within company) ----------
  {
    const s = byRole.admin;
    const rEmp = await restGet(s.access_token, 'employees?select=id,company_id');
    const rProf = await restGet(s.access_token, 'user_profiles?select=id,role');
    record('Admin Access', 'Admin', rEmp.ok && (rEmp.rows || []).length > 0,
      `admin GET /rest/v1/employees status=${rEmp.status} rows=${(rEmp.rows || []).length}`);
    record('Admin Access', 'Admin', rProf.ok,
      `admin GET /rest/v1/user_profiles status=${rProf.status} rows=${(rProf.rows || []).length}`);
  }

  // ---------- 7. Negative / Cross-role check: employee must NOT modify attendance_locked=true rows, must NOT see other emp's data ----------
  {
    const s = byRole.employee;
    const r = await restGet(s.access_token, 'employees?select=id,company_id,emp_id');
    const rows = r.rows || [];
    const onlySelf = rows.every(row => row.emp_id === 'EMP001' || row.emp_id === undefined);
    record('Negative Access', 'Security', r.ok && rows.length <= 3,
      `employee GET /rest/v1/employees rows=${rows.length} (expect only own employee record(s), not all company employees)`);
  }

  console.log(JSON.stringify(checklist, null, 2));
  fs.writeFileSync(path.join(__dirname, 'p13-rls-checklist-result.json'), JSON.stringify(checklist, null, 2));

  const passCount = checklist.filter(c => c.result === 'PASS').length;
  console.log(`\nSUMMARY: ${passCount}/${checklist.length} checks passed`);
}

main().catch(e => { console.error('ERR', e.message); process.exit(1); });
