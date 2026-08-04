const { Client } = require('pg');
(async()=>{
  const databaseUrl = process.env.DATABASE_URL;
  if(!databaseUrl){ console.error('DATABASE_URL not set'); process.exit(2); }
  const c = new Client({ connectionString: databaseUrl });
  try{
    await c.connect();
    const profiles = await c.query("SELECT id, auth_uid, employee_id, company_id, role, status, email, emp_id FROM public.user_profiles WHERE company_id = 'comp_kc_clean' ORDER BY role;");
    console.log('user_profiles:', JSON.stringify(profiles.rows, null, 2));

    // Check if auth_uid values exist in auth.users (Supabase managed schema)
    let authCheck;
    try {
      authCheck = await c.query("SELECT au.id, au.email FROM auth.users au WHERE au.id = ANY($1::uuid[])", [profiles.rows.map(r => r.auth_uid)]);
      console.log('matching_auth_users_count:', authCheck.rows.length);
      console.log('matching_auth_users:', JSON.stringify(authCheck.rows, null, 2));
    } catch (e) {
      console.log('Could not query auth.users (likely insufficient privilege or schema not accessible):', e.message);
    }

    const supAssign = await c.query("SELECT sca.id, sca.user_profile_id, sca.client_id, c.client_name FROM public.supervisor_client_assignments sca LEFT JOIN public.clients c ON c.id = sca.client_id WHERE sca.company_id = 'comp_kc_clean';");
    console.log('supervisor_client_assignments:', JSON.stringify(supAssign.rows, null, 2));

  }catch(e){ console.error('ERR', e.message); process.exit(1); }
  finally{ await c.end(); }
})();
