// scripts/run-ess-migrations.js
// รัน migration ทั้งหมดใน database/*.sql บน Staging DB
//
// ปรับปรุง (แก้ปัญหา token/credit efficiency ที่พบจริง): เดิมสคริปต์นี้รันไฟล์ทั้งหมดซ้ำทุกครั้ง
// ที่มีคนเพิ่ม migration ใหม่ 1 ไฟล์ (เช่น รันไฟล์ 06-34 ซ้ำหมดทั้งที่ 33 ไฟล์ apply ไปแล้ว)
// ทำให้เสียเวลา/token อ่าน output โดยไม่จำเป็น (แม้ SQL จะ idempotent และไม่พังข้อมูลก็ตาม)
// ตอนนี้สคริปต์จะ track ว่าไฟล์ไหน apply ไปแล้วในตาราง public._schema_migrations และข้าม
// ไฟล์ที่ apply แล้ว (เช็คด้วย checksum เนื้อหาไฟล์ - ถ้าไฟล์ถูกแก้หลัง apply จะเตือนแต่ไม่รันซ้ำ
// เว้นแต่สั่ง --force) ใช้งาน:
//   node scripts/run-ess-migrations.js              -> รันเฉพาะไฟล์ที่ยังไม่เคย apply
//   node scripts/run-ess-migrations.js --only 31_x.sql   -> รันเฉพาะไฟล์นี้ไฟล์เดียว (ไม่สนสถานะ)
//   node scripts/run-ess-migrations.js --force 31_x.sql  -> รันไฟล์นี้ซ้ำแม้เคย apply แล้ว (checksum เปลี่ยน)
//   node scripts/run-ess-migrations.js --force-all       -> รันทุกไฟล์ซ้ำทั้งหมด (ใช้เฉพาะกรณีจำเป็นจริงๆ)
const { Client } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./lib/env.js');

async function run() {
  const { DATABASE_URL } = getConfig();
  if (!DATABASE_URL) {
    console.error('DATABASE_URL not set in .env');
    process.exit(2);
  }

  let sanitizedConn = DATABASE_URL;
  const m = DATABASE_URL.match(/^(.*?:\/\/)([^:\/\?#]+):([^@]+)@(.*)$/);
  if (m) sanitizedConn = m[1] + m[2] + ':' + encodeURIComponent(m[3]) + '@' + m[4];

  const client = new Client({ connectionString: sanitizedConn });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS public._schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
    );
    ALTER TABLE public._schema_migrations ENABLE ROW LEVEL SECURITY;
    -- ไม่มี policy ใดๆ โดยเจตนา = default deny ทุก role ผ่าน REST/anon/authenticated
    -- (ตารางนี้ใช้เฉพาะ node script ที่ต่อผ่าน service connection string ตรงๆ เท่านั้น
    -- ไม่เคย query ผ่าน supabase-js client ฝั่งเว็บเลย)
  `);

  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf('--only');
  const forceIdx = args.indexOf('--force');
  const forceAll = args.includes('--force-all');
  const onlyFile = onlyIdx !== -1 ? args[onlyIdx + 1] : null;
  const forceFile = forceIdx !== -1 ? args[forceIdx + 1] : null;

  const files = [
    '06_leave_management.sql',
    '07_advance_payments_rls.sql',
    '08_announcements_holidays.sql',
    '09_site_assignment_rls.sql',
    '10_announcement_storage_policy.sql',
    '11_advance_payment_eligibility.sql',
    '12_leave_policy_enhancements.sql',
    '13_leave_requests_rls_recursion_fix.sql',
    '14_employee_shift_assignments.sql',
    '15_attendance_correction_requests.sql',
    '16_ot_requests.sql',
    '17_leave_hourly_and_late_tracking.sql',
    '18_employee_benefits_profile.sql',
    '19_fix_attendance_delete_trigger.sql',
    '20_night_shift_late_minutes_fix.sql',
    '21_notifications.sql',
    '22_advance_payment_estimate_summary.sql',
    '23_advance_payment_admin_tools.sql',
    '24_weekly_rest_day.sql',
    '25_attendance_ot_materialize.sql',
    '26_payroll_rates_seed.sql',
    '27_payroll_engine.sql',
    '28_notifications_self_delete.sql',
    '29_leave_correction_admin_approval_rls.sql',
    '30_payroll_schema_foreign_keys.sql',
    '31_employment_type_and_shift_differential.sql',
    '32_payroll_engine_freelance_and_shift.sql',
    '33_pay_frequency_and_period_autogen.sql',
    '34_payroll_engine_pay_frequency_filter.sql',
    '35_reporting_views_powerbi.sql',
    // เพิ่มไฟล์ migration ใหม่ต่อท้ายลิสต์นี้เสมอ (ห้าม auto-discover ทั้งโฟลเดอร์ database/
    // เพราะไฟล์ 01-05 และ schema.sql เป็นของ scripts/run-sql.js คนละ workflow กัน)
  ].map(f => path.resolve(__dirname, '..', 'database', f));

  const { rows: appliedRows } = await client.query('SELECT filename, checksum FROM public._schema_migrations;');
  const appliedMap = new Map(appliedRows.map(r => [r.filename, r.checksum]));

  const results = [];
  try {
    for (const f of files) {
      const basename = path.basename(f);
      if (onlyFile && basename !== onlyFile) continue;

      const sql = fs.readFileSync(f, 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const alreadyApplied = appliedMap.has(basename);
      const checksumChanged = alreadyApplied && appliedMap.get(basename) !== checksum;
      const shouldForce = forceAll || basename === forceFile || (onlyFile && basename === onlyFile);

      if (alreadyApplied && !shouldForce) {
        if (checksumChanged) {
          console.log(`SKIPPED (already applied, but file content changed since then - use --force ${basename} to re-run):`, basename);
        } else {
          console.log('SKIPPED (already applied):', basename);
        }
        results.push({ file: basename, status: 'skipped' });
        continue;
      }

      console.log('\n----------\nRunning file:', basename);
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO public._schema_migrations (filename, checksum, applied_at)
           VALUES ($1, $2, timezone('utc'::text, now()))
           ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = EXCLUDED.applied_at;`,
          [basename, checksum]
        );
        console.log('SUCCESS:', basename);
        results.push({ file: basename, status: 'success' });
      } catch (err) {
        console.error('ERROR executing', basename, ':', err.message);
        try { await client.query('ROLLBACK;'); } catch (e) {}
        results.push({ file: basename, status: 'failed', error: err.message });
      }
    }
  } finally {
    await client.end();
  }

  console.log('\nRun summary:');
  console.log(JSON.stringify(results, null, 2));
}

run().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

