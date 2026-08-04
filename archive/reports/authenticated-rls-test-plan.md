# Authenticated RLS Test Plan (แผนการทดสอบ RLS ผ่านการ Login จริง)

เอกสารนี้กำหนดแผนการทดสอบ Row Level Security (RLS) ของระบบ PRIFF-HMS โดยใช้ Authenticated Session จริง (ผ่าน Supabase Auth) แทนการรันแบบ Service Context/Service Role ที่ทำไปแล้วใน Phase ก่อนหน้า

เป้าหมาย: ยืนยันว่า RLS Policy ทำงานถูกต้องภายใต้ `auth.uid()` จริงของผู้ใช้แต่ละ Role (employee, supervisor, payroll, admin)

---

## 1) Pre-requisites (สิ่งที่ต้องมีก่อนเริ่มทดสอบ)

1. Migration `database/01_payroll_migration_v2.sql` ต้อง Apply แล้วบน Staging (สถานะ: ✅ เสร็จแล้ว)
2. Seed data `database/02_seed_staging_data.sql` ต้องรันแล้ว (สถานะ: ✅ เสร็จแล้ว แต่พบ Data Integrity Issue — ดู Section 6)
3. ต้องมี Supabase Auth Test Accounts ครบ 4 Role บน Staging Project (สถานะ: ❌ ยังไม่มี — ดู Section 4)
4. ต้องมีการ Mapping `auth.users.id` -> `public.user_profiles.auth_uid` ที่ถูกต้อง (สถานะ: ❌ ยังไม่มี — ปัจจุบัน auth_uid เป็นค่า `gen_random_uuid()` placeholder เท่านั้น)
5. ต้องมี Client (Browser, Postman, หรือ Node.js script) ที่สามารถเรียก `supabase.auth.signInWithPassword()` เพื่อรับ JWT Token ของแต่ละ Test Account

---

## 2) Test Accounts ที่ต้องการ (ตาม docs/staging-users-setup.md)

| Role       | Email ตัวอย่าง                  | emp_id  | หมายเหตุ |
|------------|----------------------------------|---------|----------|
| admin      | admin@kc-clean.test              | ADM001  | ใช้ Email จริง |
| payroll    | payroll@kc-clean.test            | PAY001  | ใช้ Email จริง |
| supervisor | sup1@kc-clean.internal           | SUP001  | Synthetic Email |
| employee   | emp001@kc-clean.internal         | EMP001  | Synthetic Email |

> อ้างอิงตาม docs/staging-users-setup.md ที่มีอยู่แล้วในระบบเอกสาร — แผนนี้ไม่ได้เปลี่ยนแปลงขั้นตอนที่ระบุไว้ เพียงแต่ระบุ Checklist การตรวจสอบเพิ่มเติมสำหรับการยืนยันผล

---

## 3) ขั้นตอนการทดสอบ (Test Procedure)

### Step 1: Login Test
- [ ] Login ด้วย Admin account (Email จริง + Password) ผ่าน Supabase Auth
- [ ] Login ด้วย Payroll account
- [ ] Login ด้วย Supervisor account (Synthetic Email)
- [ ] Login ด้วย Employee account (Synthetic Email)
- ผลที่คาดหวัง: ได้รับ JWT Token / Session ที่ถูกต้องสำหรับทุกบัญชี

### Step 2: Session Verification
- [ ] ตรวจสอบว่า `supabase.auth.getSession()` คืนค่า session ที่มี `user.id` ตรงกับ `auth.users.id` ที่สร้างไว้
- [ ] ตรวจสอบว่า Session ไม่หมดอายุก่อนเริ่มการทดสอบ (Token TTL)

### Step 3: Role Validation
- [ ] เรียก `SELECT public.get_user_role();` ผ่าน session ของแต่ละบัญชี และตรวจสอบว่าค่าตรงกับ role ที่กำหนดใน `user_profiles`
- [ ] เรียก `SELECT public.get_user_company();` และตรวจสอบว่าตรงกับ `comp_kc_clean`
- [ ] เรียก `SELECT public.is_active_user();` และตรวจสอบว่าคืนค่า true

### Step 4: Attendance Access Test
- [ ] Employee: SELECT `attendance_logs` — ควรเห็นเฉพาะแถวของตนเอง (emp_id ตรงกับ session)
- [ ] Employee: พยายาม UPDATE attendance ของคนอื่น — ควรถูกปฏิเสธ (0 rows affected)
- [ ] Supervisor: SELECT `attendance_logs` — ควรเห็นเฉพาะ client_id ที่อยู่ใน `supervisor_client_assignments` ของตน
- [ ] Supervisor: พยายาม SELECT/UPDATE attendance ของ client ที่ไม่ได้รับมอบหมาย — ควรถูกปฏิเสธ

### Step 5: Payroll Access Test
- [ ] Payroll: SELECT/INSERT/UPDATE บน `payroll_periods`, `payroll_runs`, `payroll_lines` — ควรทำได้ภายใน company_id ของตน
- [ ] Employee/Supervisor: พยายามเข้าถึง `payroll_runs`/`payroll_lines` โดยตรง — ควรถูกปฏิเสธหรือไม่มีแถว (Payroll Isolation)
- [ ] Employee: SELECT `payroll_payslips` ของตนเอง — ควรเห็นเฉพาะของตนเอง

### Step 6: Supervisor Scope Test
- [ ] Supervisor: SELECT `supervisor_client_assignments` ของตนเอง — ควรเห็นเฉพาะแถวที่ user_profile_id ตรงกับตน
- [ ] ตรวจสอบว่า Supervisor มองไม่เห็น attendance ของ client อื่นที่ไม่ได้ผูกไว้

### Step 7: Admin Access Test
- [ ] Admin: SELECT ทุกตารางภายใน company_id เดียวกัน (employees, attendance_logs, payroll_*, ฯลฯ) — ควรเข้าถึงได้ครบ
- [ ] Admin: ตรวจสอบว่าไม่เห็นข้อมูลของ company_id อื่น (ถ้ามีข้อมูลทดสอบข้ามบริษัท)

### Step 8: Negative / Cross-Role Test
- [ ] Employee พยายามเรียก endpoint/query ที่สงวนไว้สำหรับ Payroll — ควรถูกปฏิเสธ
- [ ] Supervisor พยายามดู payroll_runs — ควรไม่มีแถว หรือถูกปฏิเสธ

---

## 4) Blockers ที่ต้องให้มนุษย์ดำเนินการ (Human-Required Actions)

รายการนี้คือสิ่งที่ Agent/Automation **ไม่สามารถทำแทนได้** เนื่องจากข้อจำกัดด้านสิทธิ์ ความปลอดภัย หรือกระบวนการที่ต้องผ่าน Dashboard ของ Supabase โดยตรง:

1. **สร้างบัญชี Supabase Auth จริง** — ต้องดำเนินการผ่าน Supabase Dashboard (Authentication > Users) หรือ Admin API ที่ใช้ Service Role Key ซึ่งไม่ได้ถูกจัดเตรียมไว้ในสภาพแวดล้อมการทำงานปัจจุบัน (DATABASE_URL ที่มีอยู่เป็น Postgres direct connection ไม่ใช่ Supabase Auth Admin API)
2. **เชื่อม auth.users.id เข้ากับ user_profiles.auth_uid** — ต้องใช้ค่า UID จริงจากบัญชีที่สร้างในข้อ 1 แล้วนำมา UPDATE ด้วยมือ (หรือสคริปต์ที่ DBA อนุมัติ)
3. **ยืนยันตัวตน (Sign-in) เพื่อรับ JWT** — ต้องดำเนินการผ่าน Client จริง (Browser/Postman/Node script ที่เรียก `supabase.auth.signInWithPassword`) เพราะ Agent ไม่มีสิทธิ์เข้าถึง Supabase Anon/Public API Key ในสภาพแวดล้อมนี้
4. **Permission ไม่เพียงพอสำหรับ auth.users** — การเชื่อมต่อผ่าน DATABASE_URL (Postgres role `postgres`) สามารถ query `auth.users` ได้ในบางกรณี แต่การสร้างผู้ใช้ใหม่ในระบบ Auth (ที่ต้องผ่าน GoTrue service) ไม่สามารถทำผ่าน SQL โดยตรงได้อย่างปลอดภัย — ต้องใช้ Supabase Dashboard หรือ Admin API เท่านั้น
5. **การตัดสินใจด้าน Data Cleanup** — พบข้อมูลซ้ำซ้อนจากการรัน Seed ก่อนหน้าที่ยังไม่ Idempotent (ดู Section 6) จำเป็นต้องให้ DBA ตัดสินใจว่าจะลบข้อมูลซ้ำหรือไม่ ก่อนดำเนินการ Mapping auth_uid

---

## 5) สิ่งที่ Agent/Automation ทำได้เอง (Automatable Parts)

- ตรวจสอบ Schema, Column, Constraint ของ `user_profiles` และตารางที่เกี่ยวข้อง (ทำแล้ว)
- ตรวจสอบว่า `auth_uid` ปัจจุบันเป็นค่า Mapping จริงหรือ Placeholder (ทำแล้ว — พบว่าเป็น Placeholder ทั้งหมด)
- เตรียม SQL Query สำหรับ Role Validation, Attendance Access, Payroll Access เพื่อให้ Human Tester Copy ไปรันหลังจาก Login จริง (มีอยู่แล้วใน `database/03_test_rls_policies.sql` และ autofill version)
- สรุปผลลัพธ์เป็นรายงานเมื่อ Human Tester ให้ผลลัพธ์ Query กลับมา

---

## 6) Data Integrity Findings (พบระหว่างการตรวจสอบ ก่อนเริ่ม Authenticated Test)

จากการตรวจสอบ `user_profiles`, `employees`, และ `clients` บน Staging พบข้อมูลซ้ำซ้อนดังนี้ (ผลจากการรัน Seed หลายครั้งก่อนที่จะปรับให้ Idempotent):

| ตาราง | รายการ | จำนวนซ้ำ |
|--------|--------|----------|
| employees | emp_id = ADM001 | 2 |
| employees | emp_id = EMP001 | 2 |
| employees | emp_id = PAY001 | 2 |
| employees | emp_id = SUP001 | 2 |
| clients | client_name = 'Site A' | 2 |
| clients | client_name = 'Site B' | 2 |
| user_profiles | role = admin | 3 |
| user_profiles | role = payroll | 3 |
| user_profiles | role = supervisor | 3 |
| user_profiles | role = employee | 3 |

**ผลกระทบต่อการทดสอบ:** เมื่อทำการ Mapping `auth_uid` จริง จะต้องเลือกว่าจะ Mapping เข้ากับ `user_profiles` record ใดในกลุ่มที่ซ้ำกัน (แนะนำให้เลือก record ล่าสุด หรือให้ DBA ลบข้อมูลซ้ำก่อน) — นี่คือ Data Cleanup ที่ต้องมนุษย์ตัดสินใจ ไม่ใช่การเปลี่ยนแปลง Schema

**ข้อควรระวัง:** การลบข้อมูลซ้ำเป็น Data Operation ไม่ใช่ Schema Change แต่ควรมีการอนุมัติก่อนดำเนินการ เนื่องจากอาจกระทบ Foreign Key ที่อ้างอิงไปยัง record ที่จะถูกลบ

---

## 7) ข้อจำกัดของแผนนี้ (Out of Scope)
- ห้ามสร้าง Feature ใหม่
- ห้ามแก้ Schema (DDL)
- ห้ามแก้ไฟล์ HTML
- ห้ามแก้ไฟล์ JavaScript
- ห้ามแก้ RLS Policy

แผนนี้เป็นเพียงการตรวจสอบ (Verification) และเตรียมความพร้อม (Readiness Check) เท่านั้น
