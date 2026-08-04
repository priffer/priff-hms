// auth-guard.js
// Client-side auth guard for PRIFF-HMS
// - Uses Supabase client available as window.supabase or window.supabaseClient
// - Do NOT use localStorage for session storage in new flow

const sb = window.supabase || window.supabaseClient;
if (!sb) console.warn('Supabase client not found as window.supabase or window.supabaseClient');

async function getCurrentSession() {
  // Supabase client v2: getSession() returns { data: { session } }
  if (!sb || !sb.auth) return null;
  try {
    const { data, error } = await sb.auth.getSession();
    if (error) return null;
    return data?.session ?? null;
  } catch (e) {
    console.error('getCurrentSession error', e);
    return null;
  }
}

async function getCurrentUserProfile() {
  if (!sb || !sb.auth) return null;
  const sessionData = await getCurrentSession();
  const uid = sessionData?.user?.id;
  if (!uid) return null;
  // Fetch user_profiles by auth_uid
  const { data, error } = await sb.from('user_profiles').select('*').eq('auth_uid', uid).single();
  if (error) {
    console.error('getCurrentUserProfile error', error);
    return null;
  }
  return data;
}

async function requireAuth(allowedRoles = [], options = {}) {
  // allowedRoles: array of roles that can access (e.g. ['admin','payroll'])
  // options: { redirectTo: '/login.html' }
  const redirectTo = options.redirectTo || '/login.html';
  const session = await getCurrentSession();
  if (!session) {
    window.location.href = redirectTo;
    return false;
  }
  const profile = await getCurrentUserProfile();
  if (!profile || profile.status !== 'active') {
    console.warn('User profile not active or missing', profile);
    window.location.href = redirectTo;
    return false;
  }
  if (allowedRoles.length > 0 && !allowedRoles.includes(profile.role)) {
    // role mismatch
    console.warn('Access denied. Required roles:', allowedRoles, 'Got:', profile.role);
    // optionally show an alert and redirect
    window.location.href = '/unauthorized.html';
    return false;
  }
  // OK
  return true;
}

async function requireLoginRedirect() {
  const session = await getCurrentSession();
  if (!session) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

async function signOut() {
  if (!sb || !sb.auth) return;
  try {
    await sb.auth.signOut();
    // Ensure no legacy localStorage usage remains
    try { localStorage.removeItem('priff_emp_session'); } catch(e){}
    window.location.href = '/login.html';
  } catch (e) {
    console.error('Sign out error', e);
  }
}

// Export for pages to use
window.PriffAuthGuard = {
  getCurrentSession,
  getCurrentUserProfile,
  requireAuth,
  requireLoginRedirect,
  signOut
};
