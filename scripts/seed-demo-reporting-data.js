// scripts/seed-demo-reporting-data.js
// Phase 4: สร้างข้อมูล demo ให้ครบสำหรับหน้ารายงาน/Dashboard (admin-reports.html)
// - 5 ลูกค้าจำลอง (clients) ตามที่ user ขอ
// - พนักงานจำลอง 20 คน (emp_id ขึ้นต้นด้วย DEMORPT ตามธรรมเนียม DEMO* - ดู .agent-rules.md):
//     15 คนยังทำงานอยู่ (active) + 5 คนลาออกแล้ว (resigned) กระจายคนละเดือน (มี.ค.-ก.ค. 2026)
//     เพื่อให้กราฟอัตราลาออกมีจุดข้อมูลหลายเดือน
// - attendance_logs ย้อนหลัง ~2 เดือน (2026-06-01 ถึงวันนี้) ครอบคลุม มาตรงเวลา/มาสาย/ขาดงาน/ลา/OT
// - ใช้ trigger จริงของระบบ (fn_attendance_compute_late_minutes, fn_materialize_attendance_ot)
//   แทนการยัด attendance_ot_details/late_minutes ตรงๆ - ไม่แตะ/ไม่ทำซ้ำ Payroll Engine logic
//
// Idempotent: รันซ้ำได้ปลอดภัย - ลบข้อมูล DEMORPT เดิมทั้งหมดก่อนสร้างใหม่เสมอ (reset & reseed)
// ใช้ได้กับ Staging เท่านั้น (ตรวจสอบ COMPANY_ID + emp_id prefix ก่อนลบทุกครั้ง)
//
// Usage: node scripts/seed-demo-reporting-data.js

const { Client } = require('pg');
const { getConfig } = require('./lib/env.js');

const COMPANY_ID = 'comp_kc_clean';
const EMP_PREFIX = 'DEMORPT';

const CLIENT_DEFS = [
  { name: 'บริษัท สยามอินโนเวชั่น จำกัด (สำนักงานใหญ่ อโศก)', location: 'กรุงเทพฯ (อโศก)', contact: 'คุณศิริพร วงศ์ทอง' },
  { name: 'บริษัท ไทยฟู้ดโปรดักส์ จำกัด (มหาชน) (คลังสินค้าบางนา)', location: 'สมุทรปราการ (บางนา)', contact: 'คุณอนุชา พงษ์ไพศาล' },
  { name: 'โรงพยาบาลรวมแพทย์กรุงเทพ (อาคารผู้ป่วยนอก)', location: 'กรุงเทพฯ (ราชเทวี)', contact: 'คุณจิราพร เอี่ยมสอาด' },
  { name: 'ธนาคารกรุงศรีอยุธยา จำกัด (มหาชน) (สาขาสีลม)', location: 'กรุงเทพฯ (สีลม)', contact: 'คุณธนากร ศรีสุข' },
  { name: 'บริษัท เซ็นทรัลรีเทล คอร์ปอเรชั่น จำกัด (มหาชน) (ศูนย์การค้าเซ็นทรัลเวิลด์)', location: 'กรุงเทพฯ (ราชประสงค์)', contact: 'คุณเบญจมาศ ทองมี' },
];

// clientIdx อ้างอิง index ใน CLIENT_DEFS ด้านบน
const ACTIVE_EMPLOYEES = [
  { n: '001', name: 'นางสาวสมหญิง ใจดี', clientIdx: 0, salaryType: 'monthly', monthly: 12000 },
  { n: '002', name: 'นายประเสริฐ ขยันงาน', clientIdx: 0, salaryType: 'monthly', monthly: 12500 },
  { n: '003', name: 'นางสาวมาลี รักงาน', clientIdx: 0, salaryType: 'daily', daily: 480 },
  { n: '004', name: 'นายสมพงษ์ ตั้งใจทำ', clientIdx: 1, salaryType: 'monthly', monthly: 13000 },
  { n: '005', name: 'นางสาวปราณี สู้งาน', clientIdx: 1, salaryType: 'monthly', monthly: 12000 },
  { n: '006', name: 'นายวิรัตน์ ขยันดี', clientIdx: 1, salaryType: 'daily', daily: 500 },
  { n: '007', name: 'นางสาวจิราภรณ์ ใจสู้', clientIdx: 2, salaryType: 'monthly', monthly: 12500 },
  { n: '008', name: 'นายสุชาติ มุ่งมั่น', clientIdx: 2, salaryType: 'monthly', monthly: 13500 },
  { n: '009', name: 'นางสาวอรุณี พากเพียร', clientIdx: 2, salaryType: 'daily', daily: 490 },
  { n: '010', name: 'นายอนุชา ทำดี', clientIdx: 3, salaryType: 'monthly', monthly: 12000 },
  { n: '011', name: 'นางสาวศิริพร ขยัน', clientIdx: 3, salaryType: 'monthly', monthly: 12800 },
  { n: '012', name: 'นายกิตติศักดิ์ สู้ชีวิต', clientIdx: 3, salaryType: 'daily', daily: 470 },
  { n: '013', name: 'นางสาวพรทิพย์ ใจเย็น', clientIdx: 4, salaryType: 'monthly', monthly: 13200 },
  { n: '014', name: 'นายธนากร มั่นคง', clientIdx: 4, salaryType: 'monthly', monthly: 12300 },
  { n: '015', name: 'นางสาวเบญจมาศ รักองค์กร', clientIdx: 4, salaryType: 'daily', daily: 510 },
];

// วันที่ลาออกกระจายคนละเดือน (มี.ค.-ก.ค. 2026) ให้กราฟ turnover มีหลายจุด
const RESIGNED_EMPLOYEES = [
  { n: '016', name: 'นายวีระชัย เปลี่ยนงาน', clientIdx: 0, salaryType: 'monthly', monthly: 12000, resignDate: '2026-03-15', reason: 'ลาออกเพื่อไปทำงานใกล้บ้าน' },
  { n: '017', name: 'นางสาวสุนิสา ย้ายที่อยู่', clientIdx: 1, salaryType: 'monthly', monthly: 12500, resignDate: '2026-04-20', reason: 'ย้ายที่อยู่ตามครอบครัว' },
  { n: '018', name: 'นายชาญวิทย์ ไปเรียนต่อ', clientIdx: 2, salaryType: 'daily', daily: 480, resignDate: '2026-05-10', reason: 'ลาออกไปศึกษาต่อ' },
  { n: '019', name: 'นางสาวรัตนา กลับบ้านเกิด', clientIdx: 3, salaryType: 'monthly', monthly: 13000, resignDate: '2026-06-25', reason: 'กลับภูมิลำเนา' },
  { n: '020', name: 'นายไพโรจน์ เปลี่ยนสายงาน', clientIdx: 4, salaryType: 'daily', daily: 500, resignDate: '2026-07-05', reason: 'เปลี่ยนสายงาน' },
];

const SHIFT_START = '08:00:00';
const SHIFT_END = '17:00:00';
const STANDARD_HOURS = 8;
const WEEKLY_REST_DAY = 0; // อาทิตย์

function toTimeStr(hh, mm) {
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
}
function addMinutesToTime(baseHH, baseMM, addMin) {
  const total = baseHH * 60 + baseMM + addMin;
  return toTimeStr(Math.floor(total / 60), total % 60);
}
function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}
function rand(min, max) {
  return Math.random() * (max - min) + min;
}
function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

async function main() {
  const { DATABASE_URL } = getConfig();
  const m = DATABASE_URL.match(/^(.*?:\/\/)([^:\/\?#]+):([^@]+)@(.*)$/);
  const conn = m ? m[1] + m[2] + ':' + encodeURIComponent(m[3]) + '@' + m[4] : DATABASE_URL;
  const client = new Client({ connectionString: conn });
  await client.connect();

  try {
    console.log('=== 1) ลบข้อมูล demo เดิม (ถ้ามี) เพื่อ reseed สะอาด ===');
    const { rows: existingEmp } = await client.query(
      `SELECT id FROM public.employees WHERE emp_id LIKE $1`,
      [`${EMP_PREFIX}%`]
    );
    const existingIds = existingEmp.map(r => r.id);
    if (existingIds.length > 0) {
      await client.query(`DELETE FROM public.attendance_ot_details WHERE employee_id = ANY($1::uuid[])`, [existingIds]);
      try { await client.query(`DELETE FROM public.ot_materialization_log WHERE employee_id = ANY($1::uuid[])`, [existingIds]); } catch (e) { /* table/col may differ, ignore */ }
      await client.query(`DELETE FROM public.ot_requests WHERE employee_id = ANY($1::uuid[])`, [existingIds]);
      await client.query(`DELETE FROM public.leave_requests WHERE employee_id = ANY($1::uuid[])`, [existingIds]);
      await client.query(`DELETE FROM public.attendance_logs WHERE employee_id = ANY($1::uuid[])`, [existingIds]);
      await client.query(`DELETE FROM public.employee_movements WHERE emp_db_id = ANY($1::uuid[])`, [existingIds]);
      await client.query(`DELETE FROM public.employee_shift_assignments WHERE employee_id = ANY($1::uuid[])`, [existingIds]);
      await client.query(`DELETE FROM public.employees WHERE id = ANY($1::uuid[])`, [existingIds]);
      console.log(`ลบพนักงาน demo เดิม ${existingIds.length} คน + ข้อมูลที่เกี่ยวข้องแล้ว`);
    } else {
      console.log('ไม่มีข้อมูล demo เดิม');
    }
    // ลบ client demo เดิม (ระบุด้วยชื่อเป๊ะๆ เท่านั้น ปลอดภัยต่อ client จริง)
    await client.query(`DELETE FROM public.clients WHERE client_name = ANY($1::text[])`, [CLIENT_DEFS.map(c => c.name)]);

    console.log('\n=== 2) สร้าง 5 ลูกค้าจำลอง ===');
    const clientIds = [];
    for (const c of CLIENT_DEFS) {
      const { rows } = await client.query(
        `INSERT INTO public.clients (client_name, location, contact_person) VALUES ($1, $2, $3) RETURNING id`,
        [c.name, c.location, c.contact]
      );
      clientIds.push(rows[0].id);
      console.log(`  + ${c.name} -> ${rows[0].id}`);
    }

    console.log('\n=== 3) สร้างพนักงานจำลอง (active + resigned) ===');
    const today = new Date();
    const empRecords = [];

    for (const e of ACTIVE_EMPLOYEES) {
      const empId = `${EMP_PREFIX}${e.n}`;
      const { rows } = await client.query(
        `INSERT INTO public.employees
           (full_name, emp_id, company_id, status, salary_type, monthly_salary, daily_rate,
            standard_working_hours, standard_monthly_hours, employment_type, pay_frequency)
         VALUES ($1,$2,$3,'active',$4,$5,$6,$7,208,'regular','monthly')
         RETURNING id`,
        [e.name, empId, COMPANY_ID, e.salaryType, e.salaryType === 'monthly' ? e.monthly : null, e.salaryType === 'daily' ? e.daily : null, STANDARD_HOURS]
      );
      empRecords.push({ ...e, empId, id: rows[0].id, resigned: false });
    }
    for (const e of RESIGNED_EMPLOYEES) {
      const empId = `${EMP_PREFIX}${e.n}`;
      const { rows } = await client.query(
        `INSERT INTO public.employees
           (full_name, emp_id, company_id, status, salary_type, monthly_salary, daily_rate,
            standard_working_hours, standard_monthly_hours, employment_type, pay_frequency)
         VALUES ($1,$2,$3,'resigned',$4,$5,$6,$7,208,'regular','monthly')
         RETURNING id`,
        [e.name, empId, COMPANY_ID, e.salaryType, e.salaryType === 'monthly' ? e.monthly : null, e.salaryType === 'daily' ? e.daily : null, STANDARD_HOURS]
      );
      empRecords.push({ ...e, empId, id: rows[0].id, resigned: true });
    }
    console.log(`สร้างพนักงานทั้งหมด ${empRecords.length} คน`);

    console.log('\n=== 4) สร้าง employee_shift_assignments ===');
    for (const e of empRecords) {
      let effectiveFrom, effectiveTo;
      if (e.resigned) {
        const resignDate = new Date(e.resignDate + 'T00:00:00Z');
        const from = new Date(resignDate); from.setUTCDate(from.getUTCDate() - 120);
        const to = new Date(resignDate); to.setUTCDate(to.getUTCDate() - 1);
        effectiveFrom = fmtDate(from);
        effectiveTo = fmtDate(to);
      } else {
        effectiveFrom = '2025-06-01';
        effectiveTo = null;
      }
      await client.query(
        `INSERT INTO public.employee_shift_assignments
           (company_id, employee_id, shift_name, shift_start, shift_end, standard_hours, effective_from, effective_to, weekly_rest_day)
         VALUES ($1,$2,'กะปกติ (08:00-17:00)',$3,$4,$5,$6,$7,$8)`,
        [COMPANY_ID, e.id, SHIFT_START, SHIFT_END, STANDARD_HOURS, effectiveFrom, effectiveTo, WEEKLY_REST_DAY]
      );
    }
    console.log('สร้าง shift assignment ครบทุกคน');

    console.log('\n=== 5) สร้าง employee_movements (ลาออก) สำหรับ turnover ===');
    for (const e of RESIGNED_EMPLOYEES) {
      const emp = empRecords.find(x => x.n === e.n && x.resigned);
      await client.query(
        `INSERT INTO public.employee_movements
           (emp_db_id, company_id, movement_type, effective_date, old_department, old_position, reason, recorded_by)
         VALUES ($1,$2,'resignation',$3,'ปฏิบัติการ','พนักงานทำความสะอาด',$4,'ADM001')`,
        [emp.id, COMPANY_ID, e.resignDate, e.reason]
      );
    }
    console.log(`บันทึกการลาออก ${RESIGNED_EMPLOYEES.length} รายการ`);

    console.log('\n=== 6) สุ่มวันลาที่อนุมัติแล้ว (leave_requests) ===');
    const { rows: leaveTypeRows } = await client.query(
      `SELECT id FROM public.leave_types WHERE company_id = $1 AND code = 'sick' LIMIT 1`,
      [COMPANY_ID]
    );
    const sickLeaveTypeId = leaveTypeRows[0]?.id;
    const leaveDatesByEmployee = {}; // employee_id -> Set of 'YYYY-MM-DD' ที่ลา (ข้าม attendance วันนั้น)

    for (const e of empRecords) {
      leaveDatesByEmployee[e.id] = new Set();
      if (e.resigned) continue; // ไม่ยุ่งกับคนลาออกให้ง่ายต่อการดูช่วงทำงานจริง
      if (!sickLeaveTypeId) continue;
      // แต่ละคนลาป่วย 1 ช่วง (1-2 วัน) สุ่มในเดือน ก.ค. 2026
      const startDay = randInt(3, 25);
      const leaveDays = randInt(1, 2);
      const startDate = new Date(Date.UTC(2026, 6, startDay)); // เดือน ก.ค. (0-indexed=6)
      const endDate = new Date(startDate); endDate.setUTCDate(endDate.getUTCDate() + leaveDays - 1);
      await client.query(
        `INSERT INTO public.leave_requests
           (company_id, employee_id, emp_id, leave_type_id, start_date, end_date, total_days, reason, status, approved_by, approved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ลาป่วย (ข้อมูลจำลอง)','approved',NULL,now())`,
        [COMPANY_ID, e.id, e.empId, sickLeaveTypeId, fmtDate(startDate), fmtDate(endDate), leaveDays]
      );
      for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
        leaveDatesByEmployee[e.id].add(fmtDate(d));
      }
    }
    console.log('สร้างคำขอลาป่วยตัวอย่างแล้ว');

    console.log('\n=== 7) สร้าง attendance_logs (+ OT requests ที่อนุมัติแล้วสำหรับวันทำ OT) ===');
    const { rows: holidays } = await client.query(
      `SELECT holiday_date FROM public.company_holidays WHERE company_id = $1`,
      [COMPANY_ID]
    );
    const holidaySet = new Set(holidays.map(h => fmtDate(new Date(h.holiday_date))));

    let totalLogs = 0, totalOtDays = 0, totalLate = 0, totalAbsent = 0;

    for (const e of empRecords) {
      const client_id = clientIds[e.clientIdx];
      let rangeStart, rangeEnd;
      if (e.resigned) {
        const resignDate = new Date(e.resignDate + 'T00:00:00Z');
        rangeEnd = new Date(resignDate); rangeEnd.setUTCDate(rangeEnd.getUTCDate() - 1);
        rangeStart = new Date(resignDate); rangeStart.setUTCDate(rangeStart.getUTCDate() - 28);
      } else {
        rangeStart = new Date(Date.UTC(2026, 5, 1)); // 2026-06-01
        rangeEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      }

      for (let d = new Date(rangeStart); d <= rangeEnd; d.setUTCDate(d.getUTCDate() + 1)) {
        const dow = d.getUTCDay();
        const dateStr = fmtDate(d);
        if (dow === WEEKLY_REST_DAY) continue; // วันหยุดประจำสัปดาห์
        if (holidaySet.has(dateStr)) continue; // วันหยุดบริษัท
        if (leaveDatesByEmployee[e.id]?.has(dateStr)) continue; // วันลา (ไม่มี attendance log)

        const roll = Math.random();
        if (roll < 0.07) {
          totalAbsent++;
          continue; // ขาดงาน (ไม่มี attendance log เลย)
        }

        const isLate = Math.random() < 0.22;
        const checkIn = isLate ? addMinutesToTime(8, 0, randInt(5, 40)) : addMinutesToTime(8, 0, -randInt(0, 5));
        if (isLate) totalLate++;

        const isOtDay = Math.random() < 0.15;
        let checkOut = SHIFT_END;
        let totalHours = STANDARD_HOURS;
        let otHours = 0;
        if (isOtDay) {
          otHours = randInt(1, 3);
          checkOut = addMinutesToTime(17, 0, otHours * 60);
          totalHours = STANDARD_HOURS + otHours;
          totalOtDays++;
          // ต้องมี ot_requests สถานะ approved ก่อน insert attendance_log เพื่อให้ trigger
          // fn_materialize_attendance_ot คำนวณ OT hours จริง (LEAST(raw_ot, approved_ot))
          await client.query(
            `INSERT INTO public.ot_requests
               (company_id, employee_id, emp_id, work_date, requested_start, requested_end, requested_hours,
                reason, status, resolved_approver_role, requires_admin_review, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'ทำงานล่วงเวลาตามที่ลูกค้าร้องขอ (ข้อมูลจำลอง)','approved','supervisor',false,$8)`,
            [COMPANY_ID, e.id, e.empId, dateStr, SHIFT_END, checkOut, otHours, `${dateStr}T00:00:00Z`]
          );
        }

        await client.query(
          `INSERT INTO public.attendance_logs
             (emp_id, employee_id, company_id, client_id, work_date, check_in, check_out, total_hours, status, check_in_method)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'present','mobile_app')`,
          [e.empId, e.id, COMPANY_ID, client_id, dateStr, checkIn, checkOut, totalHours]
        );
        totalLogs++;
      }
    }
    console.log(`สร้าง attendance_logs ${totalLogs} แถว (มาสาย ~${totalLate}, ขาดงาน ~${totalAbsent}, วันทำ OT ~${totalOtDays})`);

    console.log('\n✅ Seed demo reporting data สำเร็จ');
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
