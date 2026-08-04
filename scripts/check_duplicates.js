const { Client } = require('pg');
(async()=>{
  const databaseUrl = process.env.DATABASE_URL;
  if(!databaseUrl){ console.error('DATABASE_URL not set'); process.exit(2); }
  const c = new Client({ connectionString: databaseUrl });
  try{
    await c.connect();
    const emp = await c.query("SELECT emp_id, COUNT(*) AS cnt FROM public.employees WHERE company_id='comp_kc_clean' GROUP BY emp_id ORDER BY emp_id;");
    console.log('employees_dup_check:', JSON.stringify(emp.rows, null, 2));

    const clients = await c.query("SELECT client_name, COUNT(*) AS cnt FROM public.clients GROUP BY client_name ORDER BY client_name;");
    console.log('clients_dup_check:', JSON.stringify(clients.rows, null, 2));

    const profilesCount = await c.query("SELECT role, COUNT(*) AS cnt FROM public.user_profiles WHERE company_id='comp_kc_clean' GROUP BY role ORDER BY role;");
    console.log('user_profiles_count_by_role:', JSON.stringify(profilesCount.rows, null, 2));
  }catch(e){ console.error('ERR', e.message); process.exit(1); }
  finally{ await c.end(); }
})();
