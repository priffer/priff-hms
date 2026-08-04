// login.js
// Synthetic Email Login for PRIFF-HMS
// Converts emp_id to synthetic email: <emp_id>@kc-clean.internal
// Uses Supabase client available as window.supabase or window.supabaseClient

const sb = window.supabase || window.supabaseClient;
if (!sb) console.warn('Supabase client not found as window.supabase or window.supabaseClient');

function toSyntheticEmail(empId) {
  // sanitize empId if needed
  const safe = String(empId).trim().toLowerCase();
  return `${safe}@kc-clean.internal`;
}

async function loginWithEmpId(empId, password) {
  if (!sb || !sb.auth) throw new Error('Supabase auth client not available');
  const email = toSyntheticEmail(empId);
  try {
    // Supabase v2: signInWithPassword
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      console.error('Login error', error);
      throw error;
    }
    // Ensure no legacy localStorage usage
    try { localStorage.removeItem('priff_emp_session'); } catch (e) {}
    return data;
  } catch (e) {
    throw e;
  }
}

// Helper for pages with a login form
async function handleLoginForm(event, empIdInputSelector = '#emp_id', passwordInputSelector = '#password') {
  event.preventDefault();
  const empId = document.querySelector(empIdInputSelector)?.value;
  const pwd = document.querySelector(passwordInputSelector)?.value;
  if (!empId || !pwd) {
    alert('กรุณากรอก Emp ID และรหัสผ่าน');
    return;
  }
  try {
    const result = await loginWithEmpId(empId, pwd);
    // Redirect to dashboard or provided redirect
    const redirect = new URLSearchParams(window.location.search).get('redirect') || '/dashboard.html';
    window.location.href = redirect;
  } catch (err) {
    console.error('Login failed', err);
    alert('เข้าสู่ระบบไม่สำเร็จ: ' + (err?.message || 'Unknown error'));
  }
}

// Export
window.PriffLogin = {
  toSyntheticEmail,
  loginWithEmpId,
  handleLoginForm
};
