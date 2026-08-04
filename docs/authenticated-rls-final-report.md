# Authenticated RLS Final Report — PHASE 13A

**วันที่ทดสอบ:** 2026-08-04
**Environment:** Staging/UAT (Supabase Project `hcyibcqojsyldiyzperr`, `company_id = comp_kc_clean`)
**ประเภทการทดสอบ:** Fully Automated Authenticated RLS Validation (Real Login ผ่าน Supabase Auth จริง — ไม่ใช่ Service Context)

---

## 1. สรุปผลลัพธ์ระดับสูง (Executive Summary)

| หัวข้อ | ผลลัพธ์ |
|---|---|
| Real Supabase Auth Login (4 roles) | ✅ **PASS** |
| Session Validation | ✅ **PASS** |
| Role Validation (self row readable) | ✅ **PASS** (แต่พบช่องโหว่ร้ายแรงเพิ่มเติม — ดูข้อ 3) |
| Attendance Access | ⚠️ **PASS บางส่วน / พบช่องโหว่ร้ายแรง** |
| Payroll Access | ✅ **PASS** |
| Supervisor Scope (ห้ามเห็น payroll_runs) | ✅ **PASS** |
| Admin Access | ❌ **FAIL** (`employees` table 500 error ทุก Role) |
| **ภาพรวม (Overall Verdict)** | 🔴 **FAIL — ไม่พร้อมเข้าสู่ Attendance Module / Payroll Engine จนกว่าจะแก้ไข RLS Policy ที่พบ** |

**ผลการทดสอบอัตโนมัติ:** 21/25 automated checks = PASS ตามเกณฑ์ที่ตั้งไว้เบื้องต้น **แต่การตรวจสอบ raw data เชิงลึกภายหลังพบช่องโหว่ความปลอดภัยระดับ Critical 2 รายการ ที่เกณฑ์อัตโนมัติเบื้องต้นตรวจจับไม่ครบถ้วน** (รายละเอียดข้อ 3) จึงต้องปรับผลสรุปโดยรวมเป็น **FAIL**

---

## 2. Checklist ผลการทดสอบแบบละเอียด

### 2.1 Login Validation
| Role | ผล |
|---|---|
| admin | ✅ PASS — Login สำเร็จ, ได้ JWT + auth_uid ตรงกับที่สร้าง |
| payroll | ✅ PASS |
| supervisor | ✅ PASS |
| employee | ✅ PASS |

### 2.2 Session Validation
ทดสอบ `GET /auth/v1/user` ด้วย JWT จริงของแต่ละ role — คืนค่า `id` ตรงกับ auth_uid ที่ login ทุก role
| Role | HTTP Status | ผล |
|---|---|---|
| admin/payroll/supervisor/employee | 200 (ทั้งหมด) | ✅ PASS ทุก role |

### 2.3 Role Validation
ทดสอบ `GET /rest/v1/user_profiles` — ทุก role หาแถวของตัวเองเจอ (`own_row_found=true`) ✅ PASS ผ่านเกณฑ์พื้นฐาน

**แต่พบว่าทุก role (admin/payroll/supervisor/employee) มองเห็น `user_profiles` ทั้งหมด 12 แถวเท่ากันหมด** — รวมถึงอีเมล/role ของบัญชีอื่นที่ไม่ใช่ของตนเอง (เช่น employee เห็นอีเมลและ role ของ admin/payroll/supervisor ทั้งหมด) ดูรายละเอียดช่องโหว่ในข้อ 3.1

### 2.4 Attendance Access
| Role | ผล | รายละเอียด |
|---|---|---|
| employee | ❌ **FAIL** | คาดหวังเห็นเฉพาะแถวของตนเอง (`emp_id = EMP001`) แต่กลับเห็นแถวของ `emp_id = KC260501001` (ข้อมูลบุคคลอื่น) ด้วย |
| supervisor | ✅ PASS (ผลลัพธ์ดูสมเหตุสมผล) แต่ได้รับผลกระทบจากช่องโหว่เดียวกัน (ดูข้อ 3.2) | |
| payroll | ❌ **FAIL** | เห็นแถวที่ `company_id = NULL` (ไม่ใช่ของบริษัทตนเอง) ปนอยู่ |
| admin | ✅ PASS | เห็นข้อมูลครบตามสิทธิ์ Admin |

### 2.5 Payroll Access
| Role | ผล |
|---|---|
| employee → `payroll_runs` | ✅ PASS (เห็น 0 แถว ตามที่คาดหวัง) |
| supervisor → `payroll_runs` | ✅ PASS (เห็น 0 แถว — **ไม่เห็น payroll_runs ตามข้อกำหนด**) |
| payroll → `payroll_runs` / `payroll_periods` | ✅ PASS (เข้าถึงได้ตามสิทธิ์) |
| admin → `payroll_runs` | ✅ PASS |

### 2.6 Supervisor Scope
| ทดสอบ | ผล |
|---|---|
| `supervisor_client_assignments` เข้าถึงได้ | ✅ PASS (เห็น 4 แถวตามการผูกไซต์งาน) |
| ห้ามเห็น `payroll_runs` | ✅ PASS |

### 2.7 Admin Access
| ทดสอบ | ผล |
|---|---|
| `GET /rest/v1/user_profiles` | ✅ PASS |
| `GET /rest/v1/employees` | ❌ **FAIL — HTTP 500** `infinite recursion detected in policy for relation "employees"` |

---

## 3. 🔴 ช่องโหว่ความปลอดภัยระดับ Critical ที่ค้นพบ (ไม่ได้เกิดจากงานในเฟสนี้)

> **สำคัญ:** ช่องโหว่ทั้งหมดด้านล่างนี้เป็น **Policy ที่มีอยู่ก่อนแล้วในฐานข้อมูล Staging** (ไม่ใช่สิ่งที่ Agent สร้างหรือแก้ไขใน Phase นี้) Agent เพียงตรวจพบระหว่างการทดสอบ Authenticated RLS และ **ไม่ได้แก้ไข RLS Policy ใดๆ ทั้งสิ้น** ตามข้อห้ามของ Phase 13A

### 3.1 มี RLS Policy เก่าที่อนุญาตให้ "ทุกคน" (รวมถึงผู้ไม่ได้ Login) เข้าถึงข้อมูลได้เต็มรูปแบบ

จากการตรวจสอบ `pg_policies` โดยตรง พบ Policy เก่าดังนี้ ซึ่งไม่ได้อยู่ใน `database/01_payroll_migration_v2.sql` ที่ทีมออกแบบไว้ (เป็นของเดิมที่ค้างมาก่อน):

| ตาราง | Policy Name | Role ที่ใช้ได้ | คำสั่ง | เงื่อนไข (USING) |
|---|---|---|---|---|
| `attendance_logs` | `Allow admin full access` | `authenticated` (**ทุกคนที่ Login แล้ว ไม่จำกัด role**) | ALL | `true` |
| `attendance_logs` | `Allow public select on attendance_logs` | `public` (**รวม anon — ไม่ต้อง Login ก็อ่านได้**) | SELECT | `true` |
| `attendance_logs` | `Allow public insert on attendance_logs` | `public` | INSERT | `true` |
| `attendance_logs` | `Allow public update on attendance_logs` | `public` | UPDATE | `true` |
| `employees` | `Allow admin full access` | `authenticated` | ALL | `true` |
| `employees` | `Allow public read access to employees` | `public` (**รวม anon**) | SELECT | `true` |
| `employees` | `Allow public insert` | `anon` | INSERT | `true` |

**ผลกระทบที่ยืนยันแล้วด้วยการทดสอบจริง (READ-ONLY):**
- เรียก `GET /rest/v1/attendance_logs` ด้วย **Anon Key อย่างเดียว (ไม่ Login เลย)** → ได้รับข้อมูลกลับมา 3 แถวเต็ม (HTTP 200) รวมถึงแถวของพนักงานคนอื่น (`emp_id = KC260501001`)
- เรียก `GET /rest/v1/user_profiles` ด้วย Anon Key อย่างเดียว → ได้รับข้อมูล **ครบทั้ง 12 แถว** (อีเมล, role, company_id ของทุกคนในบริษัท) โดยไม่ต้อง Login เลย
- Postgres รวม Permissive Policies หลายตัวด้วย `OR` — ดังนั้น Policy ใหม่ที่ออกแบบมาอย่างละเอียด (`attendance_select_employee`, `employees_select_self` ฯลฯ) **ถูกทำให้ไร้ผลโดยสิ้นเชิง** เพราะ Policy เก่าที่มี `USING(true)` จะ OR รวมเป็น TRUE เสมอ

**ระดับความรุนแรง:** 🔴 **CRITICAL / Data Breach Risk** — ข้อมูลพนักงาน, Attendance, และ (บางส่วน) ข้อมูลผู้ใช้ทั้งหมดของบริษัทเปิดเผยต่อสาธารณะผ่าน REST API โดยไม่ต้องยืนยันตัวตน

### 3.2 `user_profiles` และ `supervisor_client_assignments` ไม่ได้เปิดใช้งาน Row Level Security เลย

ตรวจสอบ `database/01_payroll_migration_v2.sql` พบว่า **ไม่มีคำสั่ง** `ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;` หรือ `ALTER TABLE public.supervisor_client_assignments ENABLE ROW LEVEL SECURITY;` เลยแม้แต่บรรทัดเดียว (ตรวจสอบทุกตารางอื่นแล้วมีครบ) ซึ่งสอดคล้องกับผลทดสอบที่ทุก role มองเห็น `user_profiles` เท่ากันหมด 12 แถว

**ระดับความรุนแรง:** 🔴 **CRITICAL** — ตารางนี้เก็บอีเมล/role/company_id ของผู้ใช้ทุกคน และเป็นตารางที่ Helper Function (`get_user_role()`, `get_user_company()`, `get_user_profile_id()`) ใช้อ้างอิงเพื่อกำหนดสิทธิ์ของทั้งระบบ หากไม่มี RLS ป้องกัน จะเป็นความเสี่ยงต่อการรั่วไหลข้อมูลผู้ใช้ทั้งบริษัท (หรือทุกบริษัทหากมีลูกค้าหลายราย ในอนาคต multi-tenant)

### 3.3 Policy `employees_select_self` มี Infinite Recursion Bug (บล็อกการใช้งานทุก Role)

จาก `pg_policies` พบว่า branch ของ supervisor ใน `employees_select_self` เขียนไว้ว่า:

```sql
OR (get_user_role() = 'supervisor' AND company_id = get_user_company() AND (
  department_id = (SELECT department_id FROM user_profiles WHERE auth_uid = auth.uid())
  OR emp_id IN (
    SELECT e2.emp_id FROM employees e2   -- ⚠️ Subquery อ้างอิงกลับไปที่ตาราง employees เอง
    WHERE e2.department_id = (SELECT department_id FROM user_profiles WHERE auth_uid = auth.uid())
  )
))
```

Subquery ภายใน policy **query กลับไปที่ตาราง `employees` ซึ่งเป็นตารางเดียวกับที่ policy นี้กำลังป้องกันอยู่** ทำให้ Postgres ตรวจพบ **infinite recursion (error code `42P17`)** ทุกครั้งที่มีการ `SELECT` จากตาราง `employees` ผ่าน RLS **ไม่ว่าจะเป็น role ใดก็ตาม (แม้แต่ admin ก็ error เพราะ Postgres ต้อง evaluate ทุก Permissive Policy ก่อนตัดสิน)**

**ผลกระทบที่ยืนยันแล้ว:** `GET /rest/v1/employees` คืนค่า **HTTP 500** ให้กับทุก role (admin, payroll, supervisor, employee, และแม้แต่ anon) — **ตาราง `employees` ใช้งานผ่าน REST API ไม่ได้เลยในสถานะปัจจุบัน**

**ระดับความรุนแรง:** 🔴 **CRITICAL / Functional Blocker** — Frontend หน้าใดก็ตามที่ query ตาราง `employees` ผ่าน Supabase Client จะพังทันที (500 error) ไม่ว่าจะ Login เป็น role ใด

---

## 4. สาเหตุที่เป็นไปได้ (Root Cause Analysis)

1. Policy เก่ากลุ่ม `Allow public/admin ...` (ข้อ 3.1) น่าจะเป็นของเดิมจากช่วงพัฒนาระบบเริ่มต้น (pre-payroll-migration) ที่ยังไม่มีการยกเลิก/ลบออกก่อนเพิ่ม Policy ใหม่ที่ละเอียดกว่าใน `01_payroll_migration_v2.sql` — แม้ทีมจะเพิ่ม `DROP POLICY IF EXISTS` สำหรับ Policy **ที่ Migration สร้างเอง** (Phase ก่อนหน้า) แต่ **ไม่ได้ครอบคลุม Policy ชุดเก่าที่ไม่ได้อยู่ในไฟล์ Migration เลย** (เพราะไม่รู้จักชื่อ Policy เหล่านี้มาก่อน)
2. การไม่เปิด RLS บน `user_profiles`/`supervisor_client_assignments` (ข้อ 3.2) เป็นช่องโหว่จาก Design/Implementation Gap ในการเขียน Migration File ตั้งแต่ต้น (ไม่ใช่ปัญหาจาก Environment)
3. Recursive subquery ใน `employees_select_self` (ข้อ 3.3) เป็น Logic Bug ในการออกแบบ Policy สำหรับ Supervisor branch ที่ตั้งใจจะเช็คแผนก (department) ของพนักงานคนอื่นในแผนกเดียวกัน แต่เขียนแบบ self-referencing โดยไม่ได้ป้องกัน recursion (เช่น ควรใช้ `SECURITY DEFINER` function แทนการ subquery ตรงบนตารางที่มี RLS)

---

## 5. สิ่งที่ผ่าน (What Passed)

- ✅ Supabase Auth Login จริงสำหรับทั้ง 4 role (admin/payroll/supervisor/employee) ผ่าน Password Grant
- ✅ Session Validation (`auth.uid()` ตรงกับผู้ใช้ที่ Login จริง) ทำงานถูกต้อง
- ✅ `payroll_runs`/`payroll_periods`/`payroll_lines` RLS **ทำงานถูกต้องสมบูรณ์**: employee และ supervisor ถูกบล็อกไม่ให้เห็นข้อมูล Payroll ตามที่ออกแบบไว้ (payroll/admin เท่านั้นที่เข้าถึงได้)
- ✅ `supervisor_client_assignments` เข้าถึงได้ตามสิทธิ์ Supervisor
- ✅ Auth Guard Integration (Phase 9-10) พร้อมใช้งานร่วมกับ Login/Session จริงแล้ว (แม้ยังไม่ได้ทดสอบผ่าน Browser จริง)

## 6. สิ่งที่ไม่ผ่าน (What Failed)

- ❌ **Legacy permissive policies (`USING(true)`)** บน `employees` และ `attendance_logs` เปิดช่องให้ **ทุกคนแม้ไม่ Login** อ่าน/เขียนข้อมูลได้เต็มรูปแบบ (Critical)
- ❌ **`user_profiles` และ `supervisor_client_assignments` ไม่มี RLS เปิดใช้งานเลย** (Critical)
- ❌ **`employees_select_self` policy มี infinite recursion bug** ทำให้ตาราง `employees` ใช้งานไม่ได้ผ่าน REST API สำหรับทุก role (Critical / Functional Blocker)
- ❌ Attendance/Payroll data ที่ควรถูกจำกัดด้วย `company_id`/`emp_id` รั่วไหลข้ามขอบเขต (ยืนยันจากช่องโหว่ข้อ 3.1)

## 7. สิ่งที่ต้องแก้ไข (Remediation Required — ต้องขออนุมัติ Architect ก่อนแก้ RLS Policy)

| # | รายการที่ต้องแก้ | ระดับความสำคัญ | หมายเหตุ |
|---|---|---|---|
| 1 | `DROP POLICY` Policy เก่ากลุ่ม "Allow public/admin ..." ทั้ง 7 รายการบน `employees` และ `attendance_logs` | 🔴 Critical | ต้องทำก่อนเข้าสู่ Production หรือแม้แต่ Staging ต่อเนื่อง |
| 2 | เพิ่ม `ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;` พร้อม Policy ที่เหมาะสม (เช่น self-select + admin/payroll company-wide select) | 🔴 Critical | ปัจจุบันไม่มี Policy ป้องกันเลย |
| 3 | เพิ่ม `ALTER TABLE public.supervisor_client_assignments ENABLE ROW LEVEL SECURITY;` พร้อม Policy ที่เหมาะสม | 🔴 Critical | เช่นเดียวกับข้อ 2 |
| 4 | แก้ไข `employees_select_self` supervisor branch ให้ไม่ query ตาราง `employees` ซ้ำ (เช่น เปลี่ยนเป็น `SECURITY DEFINER` function หรือปรับ Logic ไม่ให้ recursive) | 🔴 Critical | บล็อกการใช้งานตาราง employees ทั้งหมดในปัจจุบัน |
| 5 | Cleanup ข้อมูลซ้ำใน `user_profiles`/`employees`/`clients` (ค้างจาก Phase 12) | 🟡 Medium | ไม่บล็อกการทดสอบนี้ แต่ควรทำก่อนขึ้น Production |
| 6 | ยืนยัน Scope ของ Supabase Project (`hcyibcqojsyldiyzperr`) ว่าเป็น Staging แยกต่างหากจาก Production จริงหรือไม่ (พบ `admin@kccleantrade.com` และแถว `attendance_logs` emp_id `KC260501001` ที่มีลักษณะเป็นข้อมูลจริง) | 🔴 Critical | มีผลต่อการตัดสินใจว่าจะแก้ Policy บน Environment นี้ได้เลยหรือไม่ |

**Agent ไม่ได้ทำการแก้ไขข้อใดข้างต้นเลย** เนื่องจากข้อห้ามของ Phase 13A ระบุชัดเจนว่า "ห้ามแก้ RLS Policy" — ทุกข้อต้องรอการอนุมัติจาก CEO/Architect ก่อนดำเนินการ

---

## 8. บัญชีทดสอบที่สร้างในรอบนี้

ดูรายละเอียดใน [docs/test-accounts.md](/C:/Users/kungk/Desktop/Saas-project/priff-hms.worktrees/priiff-hms-system-audit-report/docs/test-accounts.md) — สร้างครบ 4 บัญชี (admin/payroll/supervisor/employee) ผ่าน Supabase Admin API และ Login จริงสำเร็จทั้งหมด บัญชีจริงเดิม `admin@kccleantrade.com` ไม่ถูกแตะต้อง

---

## 9. คำตอบต่อเป้าหมายของ Phase 13A

> "ยืนยันว่า Supabase Auth + RLS Policy + Auth Guard ทำงานจริงภายใต้ auth.uid() จริง และสรุปความพร้อมก่อนเข้าสู่ Attendance Module และ Payroll Engine"

- **Supabase Auth**: ✅ ทำงานถูกต้อง 100% (Login/Session/JWT ทุก role สำเร็จ)
- **RLS Policy**: ❌ **ไม่พร้อม** — พบช่องโหว่ Critical 3 รายการที่ทำให้ RLS ไม่สามารถบังคับใช้สิทธิ์ได้ตามที่ออกแบบไว้จริง (ข้อมูลรั่วไหลได้แม้ไม่ Login, ตาราง employees ใช้งานไม่ได้)
- **Auth Guard (Frontend)**: ยังไม่ได้ทดสอบผ่าน Browser จริงใน Phase นี้ (ทดสอบเฉพาะระดับ Database/REST API) — เป็นขอบเขตที่ยังไม่ครอบคลุม

### 🔴 คำแนะนำสุดท้าย: **ไม่ควรเข้าสู่ Milestone ถัดไป (Attendance Module / Payroll Engine) จนกว่าจะแก้ไข RLS Policy ทั้ง 3 รายการ Critical ข้างต้น และรันชุดทดสอบนี้ซ้ำจนผ่าน 100%**

การพัฒนา Feature ใหม่บนฐาน RLS ที่มีช่องโหว่นี้จะทำให้ความเสี่ยงด้านข้อมูลรั่วไหลขยายตัวไปยัง Feature ใหม่ทั้งหมดโดยอัตโนมัติ
