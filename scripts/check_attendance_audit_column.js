const { Client } = require('pg');
(async()=>{
  const databaseUrl = process.env.DATABASE_URL;
  if(!databaseUrl){ console.error('DATABASE_URL not set'); process.exit(2); }
  const c = new Client({ connectionString: databaseUrl });
  try{
    await c.connect();
    const col = await c.query("SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='attendance_audit_logs' AND column_name='edited_by';");
    console.log('column:', JSON.stringify(col.rows, null, 2));
    const cnt = await c.query("SELECT COUNT(*) AS null_count FROM public.attendance_audit_logs WHERE edited_by IS NULL;");
    console.log('null_count:', cnt.rows[0].null_count);
  }catch(e){ console.error('ERR', e.message); process.exit(1); }
  finally{ await c.end(); }
})();
