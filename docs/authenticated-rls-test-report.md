# Authenticated RLS Test Report (รายงานผลการตรวจสอบความพร้อมสำหรับ Authenticated RLS Testing)

สถานะเอกสาร: Pre-Test Readiness Report — เอกสารนี้สรุปผลการตรวจสอบความพร้อมของระบบก่อนเริ่มการทดสอบ RLS ผ่าน Authenticated Session จริง (ยังไม่ใช่ผลการทดสอบ End-to-End เนื่องจากยังไม่มี Supabase Auth Test Accounts จริง — ดู Blockers)

---

## 1) สรุปสถานะ Milestone ก่อนหน้า

| ขั้นตอน | สถานะ |
|---------|-------|
| Database Migration (`01_payroll_migration_v2.sql`) | ✅ สำเร็จ |
| Seed Data (`02_seed_staging_data.sql`) | ✅ สำเร็จ (แต่พบ Data Duplication จากรันก่อนหน้า) |
| RLS Test แบบ Service Context (`03_test_rls_policies.sql`) | ✅ สำเร็จ (รันผ่าน Service Role — ยังไม่ผ่านการยืนยันด้วย auth.uid() จริง) |
| Auth Guard (Frontend) | ✅ ติดตั้งแล้ว (ตามรายงานก่อนหน้า) |
| **Authenticated RLS Verification (Phase 12)** | ❌ ยังไม่เริ่ม — ติด Blocker ด้าน Supabase Auth Provisioning |

---

## 2) ผลการตรวจสอบ `docs/staging-users-setup.md`
- ไฟล์มีอยู่แล้วและมีเนื้อหาครบถ้วนตามขั้นตอนที่จำเป็น (การสร้างบัญชี, การ Mapping auth_uid, การทดสอบ RLS เบื้องต้น)
- ไม่มีการแก้ไขไฟล์นี้ในรอบนี้ (Phase 12 เป็นการตรวจสอบ ไม่ใช่การแก้ไข)

## 3) ผลการตรวจสอบข้อมูล `user_profiles`

ตรวจสอบพบข้อมูลทั้งหมด 12 แถวสำหรับ `company_id = 'comp_kc_clean'` แบ่งตาม Role ดังนี้:

| Role       | จำนวนแถว |
|------------|----------|
| admin      | 3        |
| payroll    | 3        |
| supervisor | 3        |
| employee   | 3        |

**หมายเหตุ:** จำนวนที่ควรมีคือ Role ละ 1 แถว — ตัวเลข 3 แถวต่อ Role เกิดจากการรัน Seed Script ซ้ำหลายครั้งก่อนที่จะถูกปรับให้เป็น Idempotent ใน Phase 11 (ดูรายละเอียดใน Section 6 ของ `docs/authenticated-rls-test-plan.md`)

## 4) ผลการตรวจสอบ `auth_uid` Mapping

- ตรวจสอบค่า `auth_uid` ของทุกแถวใน `user_profiles` (company_id = comp_kc_clean)
- ทำการ Query เปรียบเทียบกับตาราง `auth.users` (Supabase managed schema) เพื่อดูว่ามี auth.users.id ใดตรงกับค่า auth_uid ที่บันทึกไว้หรือไม่
- **ผลลัพธ์: พบ 0 แถวที่ตรงกัน (matching_auth_users_count = 0)**
- **สรุป:** ค่า `auth_uid` ทั้งหมดในปัจจุบันเป็นค่าที่สร้างจาก `gen_random_uuid()` ในขั้นตอน Seed (Placeholder) — ยังไม่มีการเชื่อมโยงกับบัญชี Supabase Auth จริงแม้แต่บัญชีเดียว

## 5) ผลการตรวจสอบ Test Accounts ครบ 4 Role หรือไม่

| Role       | มี user_profiles record | มี Supabase Auth User จริง | มี auth_uid Mapping ที่ถูกต้อง |
|------------|--------------------------|------------------------------|-------------------------------|
| admin      | ✅ (มี 3 แถวซ้ำ)          | ❌ ไม่มี                     | ❌ ไม่มี                       |
| payroll    | ✅ (มี 3 แถวซ้ำ)          | ❌ ไม่มี                     | ❌ ไม่มี                       |
| supervisor | ✅ (มี 3 แถวซ้ำ)          | ❌ ไม่มี                     | ❌ ไม่มี                       |
| employee   | ✅ (มี 3 แถวซ้ำ)          | ❌ ไม่มี                     | ❌ ไม่มี                       |

**สรุป: ยังไม่มี Test Account ที่พร้อมสำหรับการทดสอบ Authenticated RLS แม้แต่ Role เดียว**

## 6) ผลการตรวจสอบข้อมูลสนับสนุนอื่นๆ

- `supervisor_client_assignments`: พบ 4 แถว (ผูก Supervisor เข้ากับ "Site A" — แต่เนื่องจากมี Client "Site A" ซ้ำ 2 รายการ จึงมี Mapping ไปยัง client_id ที่ต่างกัน 2 ค่าภายใต้ชื่อเดียวกัน)
- `clients`: พบชื่อซ้ำ "Site A" x2, "Site B" x2 (มาจากการรัน Seed ก่อน Phase 11)
- `employees`: พบ emp_id ซ้ำ (ADM001, EMP001, PAY001, SUP001 อย่างละ 2 แถว)

---

## 7) Checklist สรุปผล (ตามที่ร้องขอ)

| # | รายการตรวจสอบ | สถานะ | หมายเหตุ |
|---|----------------|-------|----------|
| 1 | Login (Supabase Auth) | ⬜ ยังไม่ทดสอบ | ต้องรอสร้างบัญชีจริง |
| 2 | Session Verification | ⬜ ยังไม่ทดสอบ | ขึ้นอยู่กับข้อ 1 |
| 3 | Role Validation (`get_user_role()`) | ⬜ ยังไม่ทดสอบ | Query พร้อมแล้ว รอ Session จริง |
| 4 | Attendance Access (Employee/Supervisor) | ⬜ ยังไม่ทดสอบ | Query พร้อมแล้วใน `03_test_rls_policies.sql` |
| 5 | Payroll Access (Payroll Role + Isolation) | ⬜ ยังไม่ทดสอบ | Query พร้อมแล้ว |
| 6 | Supervisor Scope | ⬜ ยังไม่ทดสอบ | ข้อมูล mapping มีอยู่ แต่ Site A ซ้ำ ต้อง Cleanup ก่อน |
| 7 | Admin Full Access | ⬜ ยังไม่ทดสอบ | Query พร้อมแล้ว |

---

## 8) Blockers ที่ต้องให้มนุษย์ดำเนินการ (สรุปสำหรับผู้บริหาร/DBA)

1. **สร้างบัญชี Supabase Auth จริงสำหรับ 4 Role** ผ่าน Supabase Dashboard (Authentication > Users) หรือ Admin API — Agent ไม่มีสิทธิ์/ไม่มี Service Role Key ในสภาพแวดล้อมปัจจุบันเพื่อสร้างผู้ใช้ Auth โดยอัตโนมัติ
2. **คัดลอก `auth.users.id` มาอัปเดตใน `user_profiles.auth_uid`** — ต้องทำผ่าน SQL UPDATE โดย DBA หลังจากมีบัญชีจริงแล้ว
3. **ตัดสินใจเรื่อง Data Cleanup ของ user_profiles/employees/clients ที่ซ้ำซ้อน** — ก่อน Mapping auth_uid ควรมีการยืนยันว่าจะเก็บ record ใดไว้ (แนะนำให้ DBA ตรวจสอบและลบข้อมูลซ้ำ โดยระวัง Foreign Key ที่อ้างอิงอยู่ เช่น `supervisor_client_assignments`, `attendance_logs`)
4. **รันการ Sign-in จริง (signInWithPassword) ผ่าน Client** เพื่อรับ JWT Token — ต้องใช้ Supabase Anon Key และดำเนินการผ่าน Browser/Postman/Node script ที่มีสิทธิ์เข้าถึง Supabase Project (Agent ไม่มี Anon Key ในสภาพแวดล้อมปัจจุบัน)
5. **รันชุดคำสั่ง Verification ใน Context ของแต่ละบัญชีจริง** (ผ่าน PostgREST หรือ Supabase Client ที่ Login แล้ว) แล้วนำผลลัพธ์กลับมาให้ Agent วิเคราะห์ต่อ

---

## 9) สิ่งที่ Agent ดำเนินการเองสำเร็จแล้วในรอบนี้ (Automatable — Completed)

- ตรวจสอบเนื้อหาและความครบถ้วนของ `docs/staging-users-setup.md`
- ตรวจสอบข้อมูล `user_profiles` ทั้งหมดใน company_id = comp_kc_clean (12 แถว, 4 Role x 3 ซ้ำ)
- ตรวจสอบ `auth_uid` เทียบกับ `auth.users` จริง (พบว่าไม่มีการ Mapping จริงเลย)
- ตรวจสอบข้อมูลสนับสนุน (`employees`, `clients`, `supervisor_client_assignments`) เพื่อประเมินความพร้อมของ Test Data
- จัดทำ Test Plan (`docs/authenticated-rls-test-plan.md`) พร้อม Checklist และ SQL queries ที่พร้อมใช้ทันทีเมื่อมี Session จริง
- สรุป Blockers ที่ต้องให้มนุษย์ดำเนินการอย่างชัดเจน (Section 8)

---

## 10) ข้อสรุป (Conclusion)

**RLS ยังไม่ได้รับการยืนยันว่าทำงานถูกต้องภายใต้ `auth.uid()` จริง** เนื่องจากยังไม่มี Supabase Auth Test Accounts ที่เชื่อมโยงกับ `user_profiles.auth_uid` แต่อย่างใด การทดสอบที่ผ่านมา (Phase 8-11) เป็นการทดสอบผ่าน Service Context เท่านั้น ซึ่งยืนยันได้เพียงว่า **Syntax และ Logic ของ Query ถูกต้อง** แต่ไม่สามารถยืนยัน **Behavior จริงของ RLS Policy ภายใต้ Session ผู้ใช้จริง** ได้

**ส่วนที่ Agent ทำอัตโนมัติได้:**
- การตรวจสอบ Schema/Data/Configuration
- การเตรียม SQL Query สำหรับทดสอบ
- การจัดทำเอกสารและ Checklist
- การวิเคราะห์ผลลัพธ์เมื่อมนุษย์รันคำสั่งและนำผลกลับมาให้

**ส่วนที่ต้องให้มนุษย์ (DBA/Administrator) ดำเนินการ:**
- การสร้างบัญชี Supabase Auth จริงผ่าน Dashboard/Admin API
- การ Sign-in จริงเพื่อรับ JWT Token
- การตัดสินใจเรื่อง Data Cleanup ของข้อมูลซ้ำซ้อน
- การรันคำสั่ง Verification ภายใต้ Session จริงแล้วส่งผลลัพธ์กลับมา

ไม่มีการเปลี่ยนแปลง Feature, Schema, HTML, JavaScript หรือ RLS Policy ใดๆ ในรอบการตรวจสอบนี้ ตามข้อกำหนดที่ได้รับ

---

## Appendix: คำสั่งตรวจสอบที่ใช้ (สำหรับอ้างอิง/ทำซ้ำได้)

```sql
-- ตรวจสอบ user_profiles
SELECT id, auth_uid, employee_id, company_id, role, status, email, emp_id
FROM public.user_profiles WHERE company_id = 'comp_kc_clean' ORDER BY role;

-- ตรวจสอบ auth_uid mapping กับ auth.users จริง
SELECT au.id, au.email FROM auth.users au WHERE au.id = ANY(ARRAY[...auth_uid ทั้งหมด...]::uuid[]);

-- ตรวจสอบข้อมูลซ้ำ
SELECT emp_id, COUNT(*) FROM public.employees WHERE company_id='comp_kc_clean' GROUP BY emp_id;
SELECT client_name, COUNT(*) FROM public.clients GROUP BY client_name;
SELECT role, COUNT(*) FROM public.user_profiles WHERE company_id='comp_kc_clean' GROUP BY role;
```
