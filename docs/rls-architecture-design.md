# RLS Architecture Design สำหรับ PRIFF-HMS

## บทนำ

เอกสารฉบับนี้สรุปการออกแบบสถาปัตยกรรม RLS (Row Level Security) สำหรับ PRIFF-HMS ตาม Baseline ที่ได้รับอนุมัติ:

- Authentication: Supabase Auth, Synthetic Email Login สำหรับพนักงาน, UUID-Based Identity
- Roles: `employee`, `supervisor`, `payroll`, `admin`
- Identity Model: `auth.users`, `user_profiles`, `employees`
- Security Principles: Least Privilege, Domain Isolation, Multi-Tenant Ready, Auditability

เป้าหมายหลักคือสร้างระบบควบคุมการเข้าถึงข้อมูลบนฐานข้อมูลภาษาไทย โดยให้ทุก table ถูกจัดการด้วย policy ที่ชัดเจนและสอดคล้องกับบทบาท

## 1. user_profiles Schema

### 1.1 โครงสร้างหลักของ `user_profiles`

`user_profiles` เป็นตารางที่เชื่อม identity ของ Supabase Auth กับบริบทธุรกิจของ PRIFF-HMS

- `id uuid` — PK
- `auth_uid uuid` — FK ไปยัง `auth.users.id` (unique)
- `employee_id uuid` — FK ไปยัง `employees.id` ถ้า user เป็นพนักงาน
- `company_id text` — tenant key สำหรับ multi-tenant isolation
- `role text` — ค่าจาก (`employee`, `supervisor`, `payroll`, `admin`)
- `status text` — lifecycle status เช่น (`invited`, `active`, `suspended`, `terminated`)
- `email text` — synthetic email หรือ email จริง
- `full_name text` — ชื่อผู้ใช้สำหรับแสดงผล
- `emp_id text` — รหัสพนักงานถ้ามี
- `department_id uuid` — แผนกของ user (สำหรับ supervisor/employee)
- `primary_client_id uuid` — site หลักที่ผู้ใช้รับผิดชอบได้
- `allowed_client_ids jsonb` — รายการ site ที่ supervisor ดูแลได้
- `metadata jsonb` — ข้อมูลเพิ่มเติมสำหรับ future claims
- `created_at timestamp` — สร้างบัญชี
- `updated_at timestamp`
- `last_sign_in_at timestamp`
- `deactivated_at timestamp`

### 1.2 ความสัมพันธ์ของ `user_profiles`

- `auth.users` 1:1 -> `user_profiles`
- `employees` 1:1/NULL -> `user_profiles` (พนักงานบางคนอาจยังไม่มี employee record ในระบบ หรือพนักงานทราบข้อมูลก่อนสร้างบัญชี)
- `departments` 1:N -> `user_profiles` ผ่าน `department_id`
- `clients` 1:N -> `user_profiles` ผ่าน `primary_client_id` และ `allowed_client_ids`

### 1.3 ดัชนีแนะนำ

- Index on `auth_uid`
- Index on `employee_id`
- Index on `(company_id, role)`
- Index on `(company_id, status)`
- GIN index on `allowed_client_ids`
- Index on `department_id`

### 1.4 Lifecycle ของ `user_profiles.status`

การจัดการสถานะต้องรองรับกระบวนการชีวิตของผู้ใช้งาน:

- `invited` — บัญชีถูกสร้างแต่ยังไม่ยืนยันหรือยังไม่ active
- `active` — ใช้งานได้ตาม role
- `suspended` — ชั่วคราวระงับการใช้งาน เช่น ต้องตรวจสอบ security หรือถูกระงับชั่วคราว
- `terminated` — เลิกจ้าง/ย้ายออก ไม่ให้เข้าถึงข้อมูลอีกต่อไป

นอกจากนี้ควรมีเงื่อนไขระบบที่เช็คทั้ง `status = 'active'` และ `auth.uid()` ใน policy

## 2. RLS Architecture

### 2.1 หลักการทั่วไป

- บังคับ `company_id` บนทุก table ที่มีข้อมูลธุรกิจ
- ใช้ `auth.jwt()` claims จาก Supabase Auth เพื่อกำหนด `role` และ `company_id`
- ให้ default policy เป็น DENY แล้วเปิดเฉพาะ policy ที่ต้องการเท่านั้น
- ให้ permission แยกตามรูปร่างของข้อมูลและบทบาท
- ให้ `employee` เข้าถึงเฉพาะข้อมูลของตัวเอง
- ให้ `supervisor` เข้าถึงข้อมูลของทีม/ไซต์งานที่รับผิดชอบ
- ให้ `payroll` จัดการข้อมูล payroll โดยไม่จำเป็นต้องเข้าถึง attendance/HR ที่เกินจำเป็น
- ให้ `admin` เข้าถึงได้ครบถ้วนตามบริษัท

### 2.2 เทมเพลต policy แบบ standardized

- `company_id = auth.jwt() -> company_id`
- `auth.role() = 'authenticated'` ต้องเชื่อมกับ `user_profiles.status = 'active'`
- `auth.jwt() -> role` ต้องตรงกับ `user_profiles.role`
- ใช้ `auth.jwt() -> employee_id` หรือ `auth.uid()` เพื่อกรองข้อมูล owned

### 2.3 กรอบการออกแบบสำหรับแต่ละตาราง

#### 2.3.1 employees

- `employee`:
  - SELECT เฉพาะ record ของตัวเอง (`employees.id = user_profiles.employee_id`)
  - UPDATE เฉพาะ fields ที่อนุญาตสำหรับ self-service เช่น `phone_number`, `current_address`, `emergency_contact`
  - INSERT/DELETE: ห้าม
- `supervisor`:
  - SELECT เฉพาะพนักงานในเขตที่รับผิดชอบ เช่น same `company_id` และพนักงานที่มี `client_id` หรือ `department_id` ตรงกับ `allowed_client_ids`
  - UPDATE: จำกัดเฉพาะ fields เกี่ยวกับการดูแล เช่น `department_id`, `job_group`, `status` (ถ้ามีสิทธิ์)
  - INSERT/DELETE: ห้าม (หรือหากต้องการอนุญาตเฉพาะ `supervisor` อาจเปิด INSERT เมื่อสร้าง employee ในสโคปของบริษัท)
- `payroll`:
  - SELECT fields ที่จำเป็นสำหรับ payroll เช่น `id`, `company_id`, `emp_id`, `salary_type`, `monthly_salary`, `daily_rate`, `hourly_rate`, `tax_allowance_child`, `tax_allowance_other`, `social_security_base`
  - UPDATE: จำกัดเฉพาะ field payroll-related ผ่าน policy; ไม่ให้แก้ตารางพนักงานทั้งหมด
  - INSERT/DELETE: ห้าม (admin ควบคุม)
- `admin`:
  - SELECT/INSERT/UPDATE/DELETE ทุก field ภายใน company

#### 2.3.2 attendance_logs

- `employee`:
  - SELECT เฉพาะของตัวเอง
  - INSERT เฉพาะบันทึกเข้า-ออกของตัวเอง, ต้องมี `company_id` และ `emp_id` ตรงกับ auth claims
  - UPDATE เฉพาะสถานะ `check_out` หรือ fields ที่อนุญาตหลังจากบันทึก เช่น `photo_url` หากยังไม่ locked
  - DELETE: ห้าม
- `supervisor`:
  - SELECT เฉพาะ logs ของพนักงานใน site ที่รับผิดชอบ
  - UPDATE เฉพาะ fields เช่น `status`, `manual_override_reason`, `client_id` เมื่ออยู่ในสโคปนิเทศ
  - INSERT: ห้ามหรือจำกัดการสร้างเฉพาะเมื่อแทนบันทึกแทนพนักงานจริง
- `payroll`:
  - SELECT เฉพาะ logs ที่เกี่ยวข้องกับ employee ในบริษัทเพื่อคำนวณ payroll
  - INSERT/UPDATE/DELETE: ห้าม (เพื่อให้ payroll engine ไม่เขียนข้อมูล attendance โดยตรง ถ้าจำเป็นควรเป็น service layer ที่ทำงานบน behalf)
- `admin`:
  - SELECT/UPDATE/DELETE ทั้งหมดภายในบริษัท

#### 2.3.3 attendance_ot_details

- ตารางนี้เก็บรายละเอียด OT ตามประเภท `ot15`, `ot2`, `ot3` และต้องเชื่อมกับ `attendance_logs`
- `employee`:
  - SELECT เฉพาะ record ของตนเอง
  - INSERT: จำกัดตาม log ที่เป็นของตนเอง และเฉพาะเมื่อยังไม่ locked
  - UPDATE: ห้ามหรือจำกัดมาก
  - DELETE: ห้าม
- `supervisor`, `payroll`, `admin`:
  - SELECT ตามสโคป
  - UPDATE/DELETE: เฉพาะ admin หรือผู้ใช้ที่มีสิทธิ์แก้ไข attendance

#### 2.3.4 attendance_summary

- `employee`:
  - SELECT เฉพาะ summary ของตัวเอง
  - INSERT/UPDATE/DELETE: ห้าม (สร้างโดยระบบ aggregator)
- `supervisor`:
  - SELECT summary ของพนักงานในสโคปของตน
  - UPDATE/DELETE: ห้าม
- `payroll`:
  - SELECT เพื่อคำนวณ payroll
  - UPDATE: เฉพาะเมื่อระบบ need to correct summary และ status ยังไม่ locked
  - DELETE: ห้าม
- `admin`:
  - SELECT/UPDATE/DELETE ครบถ้วน

#### 2.3.5 advance_payments

- `employee`:
  - SELECT เฉพาะ record ของตนเอง
  - INSERT เพื่อขอเบิกเงินล่วงหน้า
  - UPDATE เฉพาะ fields เช่น `transfer_slip_url`, `status` ของตนเองในกรณีรีเควสคืน/ยกเลิก ตามกฎ
  - DELETE: ห้าม
- `supervisor`:
  - SELECT records ของพนักงานที่อยู่ในสโคป
  - UPDATE เฉพาะสถานะ `approved`, `rejected` หากได้รับมอบหมาย
  - INSERT/DELETE: ห้าม
- `payroll`:
  - SELECT เพื่อใช้คำนวณการหัก payroll
  - UPDATE เฉพาะ fields `deducted_in_payroll_run_id`, `deducted_amount` เมื่อ payroll engine บันทึกผล
  - INSERT/DELETE: ห้าม
- `admin`:
  - SELECT/INSERT/UPDATE/DELETE ครบถ้วน

#### 2.3.6 employee_movements

- `employee`:
  - SELECT ประวัติของตนเอง
  - INSERT/UPDATE/DELETE: ห้าม
- `supervisor`:
  - SELECT movement ของพนักงานในสโคปของตน
  - UPDATE/INSERT/DELETE: ห้าม (admin manage)
- `payroll`:
  - SELECT เพื่อคำนวณ payroll และทำรายงาน
  - UPDATE/INSERT/DELETE: ห้าม
- `admin`:
  - SELECT/INSERT/UPDATE/DELETE ครบถ้วน

#### 2.3.7 departments

- `employee`:
  - SELECT department ใน company
  - INSERT/UPDATE/DELETE: ห้าม
- `supervisor`:
  - SELECT department ในสโคปของตน
  - INSERT/UPDATE/DELETE: ห้าม (อาจขอ admin)
- `payroll`:
  - SELECT ทุก department ใน company
  - INSERT/UPDATE/DELETE: ห้าม
- `admin`:
  - SELECT/INSERT/UPDATE/DELETE ครบถ้วน

#### 2.3.8 clients

- `employee`:
  - SELECT clients ที่เกี่ยวข้องกับตนเองหรือ clients สาธารณะของ company
  - INSERT/UPDATE/DELETE: ห้าม
- `supervisor`:
  - SELECT clients ที่ถูกมอบหมายให้ดูแล
  - UPDATE: จำกัดเฉพาะข้อมูล `contact_person` หรือ `status` เมื่อมีสิทธิ์ดูแล
  - INSERT/DELETE: ห้าม
- `payroll`:
  - SELECT clients ใน company
  - INSERT/UPDATE/DELETE: ห้าม
- `admin`:
  - SELECT/INSERT/UPDATE/DELETE ครบถ้วน

#### 2.3.9 system_settings

- `employee`:
  - SELECT เฉพาะค่าที่เป็น public หรือ company-specific display settings
  - INSERT/UPDATE/DELETE: ห้าม
- `supervisor`:
  - SELECT ค่าที่เกี่ยวข้องกับ company
  - UPDATE/DELETE: ห้าม
- `payroll`:
  - SELECT ค่าที่เกี่ยวข้องกับ payroll policy
  - UPDATE/DELETE: ห้าม
- `admin`:
  - SELECT/INSERT/UPDATE/DELETE ครบถ้วน

#### 2.3.10 payroll_periods

- `employee`:
  - SELECT เฉพาะ summary ของรอบ payroll ที่เกี่ยวข้องผ่าน view หรือ payslip
  - INSERT/UPDATE/DELETE: ห้าม
- `supervisor`:
  - SELECT เฉพาะ summary หากต้องตรวจสอบ แต่ไม่เข้าถึงรายละเอียด payroll
  - INSERT/UPDATE/DELETE: ห้าม
- `payroll`:
  - SELECT/INSERT/UPDATE เพื่อสร้างและจัดการรอบ payroll
  - DELETE: จำกัดเมื่อ status ยังไม่ locked
- `admin`:
  - SELECT/INSERT/UPDATE/DELETE ครบถ้วนโดยมี guard status

#### 2.3.11 payroll_runs

- `employee`:
  - SELECT: ห้ามเข้าถึงโดยตรงหรือเข้าถึงเฉพาะ metadata ที่เป็น public รายการสรุปเท่านั้น
  - INSERT/UPDATE/DELETE: ห้าม
- `supervisor`:
  - SELECT: ห้ามโดยตรง
  - INSERT/UPDATE/DELETE: ห้าม
- `payroll`:
  - SELECT/INSERT/UPDATE เพื่อประมวลผล payroll
  - DELETE: จำกัดเมื่อรอบยังไม่ locked
- `admin`:
  - SELECT/INSERT/UPDATE/DELETE ครบถ้วน

#### 2.3.12 payroll_lines

- `employee`:
  - SELECT เฉพาะบรรทัดของตนเองผ่าน view หรือ payslip join
  - INSERT/UPDATE/DELETE: ห้าม
- `supervisor`:
  - SELECT: ห้าม
  - INSERT/UPDATE/DELETE: ห้าม
- `payroll`:
  - SELECT/INSERT/UPDATE เพื่อจัดการ line payroll
  - DELETE: จำกัดเมื่อ status ยังไม่ locked
- `admin`:
  - SELECT/INSERT/UPDATE/DELETE ครบถ้วน

#### 2.3.13 payroll_line_details

- `employee`:
  - SELECT เฉพาะรายละเอียดของตนเองผ่าน payroll_line join
  - INSERT/UPDATE/DELETE: ห้าม
- `supervisor`:
  - SELECT/UPDATE/DELETE: ห้าม
- `payroll`:
  - SELECT/INSERT/UPDATE เพื่อเติมรายละเอียดรายการหัก/เพิ่ม
  - DELETE: จำกัดเมื่อ status ยังไม่ locked
- `admin`:
  - SELECT/INSERT/UPDATE/DELETE ครบถ้วน

#### 2.3.14 payroll_payslips

- `employee`:
  - SELECT เฉพาะ payslip ของตัวเอง
  - INSERT/UPDATE/DELETE: ห้าม
- `supervisor`:
  - SELECT: ห้ามโดยตรง (ถ้าอยากให้ supervisor ดูเพียงบางกรณีให้สร้าง view จำกัด)
  - INSERT/UPDATE/DELETE: ห้าม
- `payroll`:
  - SELECT/INSERT/UPDATE เพื่อออก payslip
  - DELETE: จำกัดเมื่อ status ยังไม่ locked
- `admin`:
  - SELECT/INSERT/UPDATE/DELETE ครบถ้วน

## 3. Permission Matrix

ตารางด้านล่างสรุปสิทธิ์บนระดับ table ตามบทบาท

- `R` = READ/SELECT
- `C` = CREATE/INSERT
- `U` = UPDATE
- `D` = DELETE

### 3.1 ตาราง Master และ Reference

- `employees`: employee=R/U(own only), supervisor=R/U(limited), payroll=R(limited), admin=CRUD
- `departments`: employee=R, supervisor=R, payroll=R, admin=CRUD
- `clients`: employee=R(limited), supervisor=R/U(limited), payroll=R, admin=CRUD
- `system_settings`: employee=R(limited), supervisor=R(limited), payroll=R(limited), admin=CRUD

### 3.2 ตาราง Attendance

- `attendance_logs`: employee=RC/U(own only), supervisor=R/U(limited), payroll=R, admin=CRUD
- `attendance_ot_details`: employee=R/C(limited), supervisor=R, payroll=R, admin=CRUD
- `attendance_summary`: employee=R, supervisor=R, payroll=R/U(limited), admin=CRUD
- `attendance_audit_logs`: employee=R(own), supervisor=R, payroll=R, admin=CRUD

### 3.3 ตาราง Payroll

- `payroll_periods`: employee=R(limited), supervisor=R(limited), payroll=CRUD(limited), admin=CRUD
- `payroll_runs`: employee=R(very limited), supervisor=-, payroll=CRUD(limited), admin=CRUD
- `payroll_lines`: employee=R(own via payslip), supervisor=-, payroll=CRUD(limited), admin=CRUD
- `payroll_line_details`: employee=R(own via payslip), supervisor=-, payroll=CRUD(limited), admin=CRUD
- `payroll_payslips`: employee=R(own), supervisor=-, payroll=CRU(limited), admin=CRUD
- `advance_payments`: employee=CRU(own), supervisor=R/U(limited), payroll=R/U(limited), admin=CRUD
- `employee_movements`: employee=R(own), supervisor=R, payroll=R, admin=CRUD

## 4. Supervisor Scope Design

### 4.1 แนวคิดการมองเห็นเฉพาะ Site งาน

Supervisor จะไม่มีสิทธิ์ดูข้อมูลทุกอย่างในบริษัท แต่จะเห็นเฉพาะพนักงานและ attendance ที่เกี่ยวข้องกับ site งาน/ลูกค้าที่รับผิดชอบ

### 4.2 โมเดลการเชื่อมโยง

- `user_profiles.allowed_client_ids` หรือ `supervisor_assignments(client_id, user_profile_id)`
- `user_profiles.department_id` เพื่อจำกัด supervisor ให้ดูพนักงานในแผนกเดียวกัน
- `attendance_logs.client_id` จะเป็นตัวเชื่อมหลักระหว่าง supervisor และ attendance
- `employees.department_id` หรือ `employees.client_id` จะใช้เพื่อเชื่อมพนักงานเข้ากับ supervisor

### 4.3 Policy ของ supervisor

- Supervisor สามารถ SELECT ข้อมูล `attendance_logs` และ `employees` เมื่อ:
  - `attendance_logs.client_id` อยู่ใน `allowed_client_ids`
  - `employees.department_id` = `user_profiles.department_id`
  - `employees.company_id` = `auth.jwt() -> company_id`
- Supervisor สามารถ UPDATE `attendance_logs.status`, `manual_override_reason` เมื่อ record อยู่ในสโคปของตน
- Supervisor ไม่สามารถเข้าถึง payroll tables โดยตรง

### 4.4 การใช้ View / helper table

เพื่อให้นโยบายชัดเจนและง่ายต่อการตรวจสอบ ควรสร้าง helper view หรือ mapping table เช่น:

- `supervisor_client_assignments` (user_profile_id, client_id)
- `supervisor_department_assignments` (user_profile_id, department_id)

เมื่อมีตาราง mapping จะเขียน RLS policy ได้ชัดเจนและนำไปใช้กับหลาย table ได้ง่ายขึ้น

## 5. Payroll Isolation Design

### 5.1 แนวทางหลัก

Payroll data ต้องถูกแยกระดับ database ให้ employee และ supervisor ไม่สามารถเข้าถึง

- `employee` สามารถดูเฉพาะ `payroll_payslips` ของตัวเอง
- `supervisor` ไม่ควรเห็น `payroll_runs`, `payroll_lines`, `payroll_line_details` โดยตรง
- `payroll` role และ `admin` เท่านั้นที่มีสิทธิ์จัดการ payroll tables

### 5.2 การใช้งาน view สำหรับ employee

สร้าง view เฉพาะสำหรับ employee เช่น `v_employee_payslips` ที่รวมข้อมูลจาก `payroll_payslips`, `payroll_lines`, `payroll_runs` และ `employees`

- policy ของ view นี้อนุญาตเฉพาะเมื่อ `payroll_payslips.employee_id = user_profiles.employee_id`
- employee จะไม่ถูกให้สิทธิ์ query ตาราง payroll ตรงๆ

### 5.3 เกณฑ์ policy ของ payroll tables

- `payroll_periods`, `payroll_runs`, `payroll_lines`, `payroll_line_details`, `payroll_payslips`
  - role `payroll` และ `admin` สามารถ SELECT/INSERT/UPDATE ตามสถานะและสิทธิ์
  - role `employee` ไม่ได้รับสิทธิ์โดยตรง
  - role `supervisor` ไม่ได้รับสิทธิ์โดยตรง

### 5.4 กรณี supervisor ต้องรายงาน

หากต้องการให้ supervisor ดูสรุป payroll เบื้องต้น ให้สร้างเฉพาะ view ที่มี aggregate data เช่น `v_supervisor_payroll_summary` โดยไม่เผยรายละเอียด line หรือ deduction

## 6. Multi-Tenant Design

### 6.1 หลักการ multi-tenant ของ PRIFF-HMS

ทุกตารางสำคัญต้องมี `company_id` เป็นคีย์แยก tenant

- `user_profiles.company_id`
- `employees.company_id`
- `attendance_logs.company_id`
- `advance_payments.company_id`
- `departments.company_id`
- `clients.company_id`
- `payroll_periods.company_id`
- `payroll_runs.company_id`
- `payroll_lines.company_id`
- `payroll_line_details.company_id`
- `payroll_payslips.company_id`
- `attendance_summary.company_id`
- `attendance_audit_logs.company_id`

### 6.2 Policy หลักสำหรับ multi-tenant

- ทุก policy ต้องตรวจสอบ `company_id = auth.jwt() -> company_id`
- `admin` ของ company A ต้องไม่สามารถเข้าถึงข้อมูล company B
- `auth.jwt()` ควรเก็บค่า `company_id` และ `role` ใน JWT claims

### 6.3 ดัชนีที่จำเป็น

- Index on `(company_id, emp_id)` สำหรับตารางที่มี employee
- Index on `(company_id, client_id)` สำหรับ attendance และ supervisor scope
- Index on `company_id` สำหรับ payroll tables และ settings

### 6.4 การแยก tenant level

- company_id เป็น tenant key หลัก
- หากต้องการขยายเพิ่มในอนาคต สามารถเพิ่ม `tenant_id` หรือ `business_unit_id` โดยไม่เปลี่ยน policy หลัก

## 7. Attendance Audit Trail Design

### 7.1 โครงสร้างตาราง `attendance_audit_logs`

ตารางนี้เก็บข้อมูลการแก้ไข attendance เพื่อรองรับ auditability และตรวจสอบย้อนหลัง

- `id uuid` — PK
- `attendance_log_id uuid` — FK ไปยัง `attendance_logs.id`
- `company_id text`
- `edited_by uuid` — `auth.users.id` ของผู้แก้ไข
- `edited_at timestamp` — เวลาที่แก้ไข
- `old_values jsonb` — snapshot ของข้อมูลก่อนแก้ไข
- `new_values jsonb` — snapshot ของข้อมูลหลังแก้ไข
- `reason text` — เหตุผลการแก้ไข
- `change_type text` — เช่น `manual_override`, `correction`, `approval`, `rollback`
- `metadata jsonb` — ข้อมูลเสริม เช่น `source`, `reviewer_id`, `approval_reference`

### 7.2 ดัชนีแนะนำ

- Index on `attendance_log_id`
- Index on `edited_by`
- Index on `company_id`

### 7.3 Policy สำหรับ `attendance_audit_logs`

- `employee`:
  - SELECT เฉพาะ log ที่เชื่อมกับ `attendance_log_id` ของตนเอง
  - INSERT: ห้าม (ระบบจะบันทึกโดยอัตโนมัติ)
  - UPDATE/DELETE: ห้าม
- `supervisor`:
  - SELECT logs ในสโคปของตน
  - INSERT/UPDATE/DELETE: ห้าม
- `payroll`:
  - SELECT logs ใน company
  - INSERT/UPDATE/DELETE: ห้าม
- `admin`:
  - SELECT/INSERT/UPDATE/DELETE ครบถ้วน

### 7.4 การเชื่อมโยงกับ process

เมื่อมีการแก้ไข attendance ต้องเขียน audit log พร้อม `old_values`, `new_values`, `reason` และ `edited_by`

- Manual override โดย admin หรือ supervisor
- การแก้ไขจาก system reconciliation
- การจัดการสถานะ flagged/locked

## 8. Payroll Lock Strategy

### 8.1 หลักการ lock

การล็อคข้อมูลต้องทำงานในระดับ DB เพื่อป้องกันการแก้ไขหลังจากรอบ payroll ถูกอนุมัติหรือข้อมูล attendance ถูกปิด

### 8.2 สถานะที่เสนอ

- `payroll_periods.status`: `draft`, `processing`, `completed`, `approved`, `locked`
- `payroll_runs.status`: `pending`, `processing`, `completed`, `approved`, `locked`
- `payroll_lines.pay_status`: `pending`, `paid`, `locked`, `rejected`
- `attendance_summary.weekly_ot_flagged`: boolean
- `attendance_summary.locked`: boolean หรือ `attendance_locked_at`
- `attendance_logs.locked`: boolean หรือ implicit lock เมื่อตกอยู่ในรอบ payroll ที่ approved

### 8.3 กฎการล็อค

- เมื่อ `payroll_periods.status = 'approved'` หรือ `payroll_runs.status = 'locked'`:
  - ห้าม INSERT/UPDATE/DELETE บน `payroll_runs`, `payroll_lines`, `payroll_line_details`, `payroll_payslips` โดย role นอก admin/payroll
  - ห้ามแก้ไข `payroll_runs` หรือ `payroll_lines` โดยแม้แต่ `payroll` role ยกเว้นการแก้ไขสำหรับกรณี rollback/adjustment ที่ audit ได้
- เมื่อ `attendance_summary.locked = true` หรือรอบ payroll ที่เกี่ยวข้องกำลัง `processing`:
  - ห้ามแก้ไข `attendance_logs` และ `attendance_summary` โดย `employee` และ `supervisor`
  - เฉพาะ `admin` หรือ service layer ที่ได้รับสิทธิ์พิเศษเท่านั้นที่แก้ไขได้
- หาก `attendance_summary.weekly_ot_flagged = true`:
  - ห้ามอนุมัติ payroll อัตโนมัติ
  - ต้องมี workflow review ก่อนเปลี่ยนรอบ payroll เป็น `processing` หรือ `approved`

### 8.4 วิธีใช้งานร่วมกับ RLS

- สร้าง policy ที่ตรวจสอบสถานะ lock ก่อนอนุญาต UPDATE/DELETE
- ใช้ `company_id` และ `role` ร่วมกันกับ `status` field
- หากต้องการ rollback ให้กำหนด policy พิเศษหรือใช้ backend service ที่มีสิทธิ์ admin

### 8.5 การจัดเก็บประวัติ lock

- เก็บ `approved_by`, `approved_at`, `locked_at` ใน `payroll_runs`
- เก็บ `locked_by`, `locked_at` ใน `attendance_summary` หรือ `attendance_logs`
- ทำให้ตรวจสอบย้อนหลังได้ว่าใครและเมื่อใดที่เปลี่ยนสถานะ

## สรุป

การออกแบบ RLS Architecture สำหรับ PRIFF-HMS ต้องยึดหลัก Least Privilege, Domain Isolation และ Multi-Tenant Ready โดยแยก:

- `user_profiles` เป็นตัวเชื่อม identity และ role
- `employees` กับ `attendance` เป็นข้อมูล operational ของพนักงาน
- `payroll_*` เป็นข้อมูลทางการเงินที่แยกเฉพาะให้ `payroll`/`admin`
- Supervisor มองเห็นเฉพาะ site งานที่รับผิดชอบ
- Employee ไม่สามารถเข้าถึง payroll data โดยตรง
- ทุก policy ต้องยืนยัน `company_id` จาก JWT claims
- มี audit trail สำหรับ attendance override และ lock strategy เพื่อรักษา data integrity

นี่เป็นพื้นฐานสถาปัตยกรรมที่ช่วยให้ PRIFF-HMS ขยายสู่ระบบ multi-tenant ได้อย่างปลอดภัย และพร้อมรองรับการพัฒนา payroll engine ในอนาคต
