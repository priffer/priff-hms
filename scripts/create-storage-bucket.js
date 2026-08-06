// scripts/create-storage-bucket.js
// สร้าง Supabase Storage bucket สำหรับไฟล์แนบประกาศบริษัท (announcement_attachments)
// ยังไม่เคยมีมาก่อน ทำให้ปุ่มอัปโหลด/ดูไฟล์แนบในหน้าประกาศใช้งานจริงไม่ได้
// ใช้ Storage Admin REST API ผ่าน service role key (.env) - idempotent (เช็คว่ามีอยู่แล้วก่อนสร้าง)
const { getConfig } = require('./lib/env.js');

const BUCKET_ID = 'announcement_attachments';

async function run() {
  const { SERVICE_KEY, PROJECT_URL } = getConfig();
  if (!SERVICE_KEY || !PROJECT_URL) {
    console.error('SUPABASE_SERVICE_ROLE_KEY หรือ PROJECT_URL ไม่พร้อมใน .env');
    process.exit(2);
  }

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  // เช็คว่ามี bucket นี้อยู่แล้วหรือยัง
  const listRes = await fetch(`${PROJECT_URL}/storage/v1/bucket`, { headers });
  const buckets = await listRes.json();
  if (!listRes.ok) {
    console.error('ดึงรายชื่อ bucket ไม่สำเร็จ:', JSON.stringify(buckets));
    process.exit(1);
  }

  const existing = (Array.isArray(buckets) ? buckets : []).find(b => b.id === BUCKET_ID || b.name === BUCKET_ID);
  if (existing) {
    console.log(`Bucket "${BUCKET_ID}" มีอยู่แล้ว (public=${existing.public}) - ไม่ต้องสร้างซ้ำ`);
    return;
  }

  const createRes = await fetch(`${PROJECT_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: BUCKET_ID,
      name: BUCKET_ID,
      public: true, // อ่านไฟล์แนบได้ผ่าน public URL โดยตรง (เหมือน recruitment_files เดิม); เขียน/ลบยังคุมด้วย service role + RLS ฝั่ง table announcements
      file_size_limit: 10485760, // 10MB ต่อไฟล์ พอสำหรับ PDF ระเบียบ/ประกาศ
      allowed_mime_types: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
    })
  });
  const created = await createRes.json();
  if (!createRes.ok) {
    console.error('สร้าง bucket ไม่สำเร็จ:', JSON.stringify(created));
    process.exit(1);
  }
  console.log(`สร้าง bucket "${BUCKET_ID}" สำเร็จ:`, JSON.stringify(created));
}

run().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
