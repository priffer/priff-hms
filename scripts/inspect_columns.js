const { Client } = require('pg');
(async()=>{
  const databaseUrl = process.env.DATABASE_URL;
  if(!databaseUrl){ console.error('DATABASE_URL not set'); process.exit(2); }
  const c = new Client({ connectionString: databaseUrl });
  try{
    await c.connect();
    const res = await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='payroll_periods' ORDER BY ordinal_position;");
    console.log(JSON.stringify(res.rows, null, 2));
  }catch(e){ console.error('ERR', e.message); process.exit(1); }
  finally{ await c.end(); }
})();
