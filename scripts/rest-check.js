// scripts/rest-check.js
// เครื่องมือตรวจสอบ Supabase REST/RPC endpoint ตรงๆ ผ่าน fetch (เทียบเท่า curl) แทนการเปิด
// browser เต็มรูปแบบ (login -> navigate -> click) เพื่อพิสูจน์ปัญหาระดับ schema/data/PostgREST
// embed relationship เช่น "Could not find a relationship between X and Y in the schema cache"
//
// ทำไมต้องมีไฟล์นี้: ระหว่าง session ที่ผ่านมา เราเปิด Playwright browser เต็มรูปแบบ (login ผ่าน UI,
// คลิกหลายหน้า) เพื่อพิสูจน์ปัญหาที่จริงๆ แล้วเป็นแค่ "PostgREST หา relationship ไม่เจอ" ซึ่งพิสูจน์
// ได้เร็วกว่ามากด้วยการยิง REST request ตรงๆ ครั้งเดียว ไม่ต้องรอ browser render ทั้งหน้า
// ใช้ browser จริงเฉพาะตอนต้องพิสูจน์ "UI แสดงผลถูกต้อง" (layout/สี/ปุ่มกดได้จริง) เท่านั้น
//
// ใช้งาน:
//   node scripts/rest-check.js "payroll_lines?select=*,employees(full_name,emp_id)&limit=1"
//   node scripts/rest-check.js "rpc/fn_generate_next_payroll_period" --method POST --body '{"p_company_id":"comp_kc_clean","p_period_type":"monthly","p_created_by":null}'
//
// Default: ใช้ SERVICE_KEY (bypass RLS) เหมาะกับตรวจ schema/embed relationship/ข้อมูลดิบ
// ถ้าต้องการตรวจ RLS ตาม role จริงของ user ต้องใช้ JWT ของ user นั้น (ส่ง --token <jwt> แทน)
const { getConfig } = require('./lib/env.js');

async function main() {
  const args = process.argv.slice(2);
  const pathArg = args[0];
  if (!pathArg) {
    console.error('Usage: node scripts/rest-check.js "<table_or_rpc_path>?<query>" [--method GET|POST] [--body \'{"k":"v"}\'] [--token <jwt>]');
    process.exit(1);
  }
  const methodIdx = args.indexOf('--method');
  const bodyIdx = args.indexOf('--body');
  const tokenIdx = args.indexOf('--token');
  const method = methodIdx !== -1 ? args[methodIdx + 1] : 'GET';
  const body = bodyIdx !== -1 ? args[bodyIdx + 1] : null;
  const token = tokenIdx !== -1 ? args[tokenIdx + 1] : null;

  const { SERVICE_KEY, PROJECT_URL } = getConfig();
  if (!PROJECT_URL) {
    console.error('PROJECT_URL could not be derived from DATABASE_URL in .env');
    process.exit(2);
  }

  const authKey = token || SERVICE_KEY;
  const url = `${PROJECT_URL}/rest/v1/${pathArg}`;
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${authKey}`,
    'Content-Type': 'application/json',
  };
  if (method === 'POST') headers.Prefer = 'return=representation';

  const res = await fetch(url, {
    method,
    headers,
    body: body || undefined,
  });

  console.log('Status:', res.status, res.statusText);
  const text = await res.text();
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
  if (!res.ok) process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
