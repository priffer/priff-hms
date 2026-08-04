# Payroll Migration Design สำหรับ PRIFF-HMS

## 1. ภาพรวม

เอกสารนี้เป็น specification สำหรับการย้าย schema และขยายฐานข้อมูลให้ PRIFF-HMS รองรับ Payroll Engine ตามมติ AI Architecture Board:

- Identity: `auth.users` -> `user_profiles` -> `employees`
- Roles: `employee`, `supervisor`, `payroll`, `admin`
- Supervisor Scope: ใช้ตาราง normalized `supervisor_client_assignments`
- Payroll Workflow: ใช้ state machine `draft -> submitted -> approved -> locked`
- OT Structure: แยกตาราง `attendance_ot_details` และ `attendance_audit_logs`

เอกสารนี้ไม่สร้าง SQL จริง แต่กำหนดสเปก ALTER TABLE และ CREATE TABLE อย่างครบถ้วน พร้อมแนวทาง state machine และ data integrity rule

## 2. Existing Tables Alterations (ALTER TABLE Specs)

### 2.1 `employees`

ตาราง `employees` จะถูกขยายด้วยคอลัมน์ payroll-ready และ compliance-ready ดังนี้:

- `salary_type text` — ประเภทเงินเดือน เช่น `monthly`, `daily`
- `monthly_salary numeric` — เงินเดือนรายเดือนสำหรับพนักงานรายเดือน
- `daily_rate numeric` — อัตราจ้างรายวันสำหรับพนักงานรายวัน
- `hourly_rate numeric` — อัตราจ้างต่อชั่วโมง
- `standard_working_hours numeric` — ชั่วโมงทำงานปกติในหนึ่งวัน (เช่น 8)
- `standard_monthly_hours numeric` — ชั่วโมงทำงานปกติในหนึ่งเดือน (เช่น 173.33)
- `social_security_base numeric` — ฐานประกันสังคมสำหรับการคำนวณ
- `social_security_employee_rate numeric` — อัตราหักประกันสังคมพนักงาน (ค่าเริ่มต้น 0.05)
- `social_security_employer_rate numeric` — อัตราหักประกันสังคมนายจ้าง
- `tax_allowance_child integer` — จำนวนบุตรเพื่อสิทธิ์ลดหย่อนภาษี
- `tax_allowance_other numeric` — ลดหย่อนภาษีอื่นๆ
- `payroll_group text` — กลุ่ม payroll หรือ policy identifier
- `auth_uid uuid` — เชื่อมกับ `auth.users.id` เพื่อยืนยัน identity chain
- `company_id text` — ยืนยัน tenant isolation หากยังไม่มี

เพิ่มเติม:
- หากตาราง `employees` ยังไม่มี `company_id` ให้เพิ่มเพื่อรองรับ multi-tenant isolation
- ควรตั้งค่าดัชนีบน `(company_id, emp_id)`, `auth_uid`, และ `department_id`

### 2.2 `advance_payments`

ปรับตาราง `advance_payments` ให้เชื่อมโยงกับ payroll run:

- `deducted_in_payroll_run_id uuid` — FK ไปยัง `payroll_runs.id`
- `deducted_amount numeric` — จำนวนเงินที่ถูกหักในรอบ payroll

เพิ่มเติมที่ควรพิจารณา:
- `approved_at timestamp with time zone`
- `approved_by uuid`
- `remarks text`
- `company_id text` (ถ้าไม่มีอยู่แล้ว)

ดัชนีแนะนำ:
- `company_id`
- `emp_id`
- `deducted_in_payroll_run_id`

### 2.3 `attendance_logs`

เพื่อรองรับ OT validation รายสัปดาห์และ multi-tenant:

- `iso_week integer` — ISO week number ของ `work_date`
- `weekly_ot_hours numeric` — ผลรวม OT สำหรับสัปดาห์นั้น ณ ขณะที่บันทึก
- `weekly_ot_flagged boolean` — ธงแจ้งเตือนเมื่อ OT เกิน 36 ชั่วโมงต่อสัปดาห์
- `company_id text` — หากยังไม่มี เพื่อรองรับ tenant isolation

เพิ่มเติมที่อาจพิจารณา:
- `employee_id uuid` — FK ไปยัง `employees.id` ในกรณีระบบเก็บรหัส employee เป็น UUID
- `attendance_locked boolean` หรือ `locked_at timestamp with time zone` เพื่อระบุ record ที่ถูกล็อคหลัง payroll approved

ดัชนีแนะนำ:
- `(company_id, emp_id)` หรือ `(company_id, employee_id)`
- `work_date`
- `client_id`
- `iso_week`

## 3. New Tables DDL Specifications (CREATE TABLE Specs)

### 3.1 `user_profiles`

ตาราง identity layer ที่เชื่อม `auth.users` กับ `employees` และบทบาทภายในระบบ

- `id uuid` — PRIMARY KEY
- `auth_uid uuid NOT NULL` — UNIQUE, FK -> `auth.users.id`
- `employee_id uuid` — FK -> `employees.id`
- `company_id text NOT NULL`
- `role text NOT NULL` — ค่า `employee`, `supervisor`, `payroll`, `admin`
- `status text NOT NULL` — ค่า `invited`, `active`, `suspended`, `terminated`
- `email text NOT NULL`
- `full_name text`
- `emp_id text`
- `department_id uuid` — FK -> `departments.id`
- `primary_client_id uuid` — FK -> `clients.id`
- `allowed_client_ids jsonb` — ใช้เก็บรายการ site/worksite ที่ supervisor ดูแลได้
- `metadata jsonb`
- `created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())`
- `updated_at timestamp with time zone`
- `last_sign_in_at timestamp with time zone`
- `deactivated_at timestamp with time zone`

Indexes:
- UNIQUE INDEX on `auth_uid`
- INDEX on `company_id`
- INDEX on `(company_id, role)`
- INDEX on `employee_id`
- INDEX on `department_id`
- GIN INDEX on `allowed_client_ids`

### 3.2 `supervisor_client_assignments`

ตาราง normalized สำหรับ scope ของ supervisor

- `id uuid` — PRIMARY KEY
- `user_profile_id uuid NOT NULL` — FK -> `user_profiles.id`
- `client_id uuid NOT NULL` — FK -> `clients.id`
- `company_id text NOT NULL`
- `assigned_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())`
- `assigned_by uuid`

Unique constraint:
- `(user_profile_id, client_id)`

Indexes:
- `company_id`
- `user_profile_id`
- `client_id`

### 3.3 `attendance_ot_details`

รายละเอียด OT แยกประเภทในระดับบันทึกเวลา

- `id uuid` — PRIMARY KEY
- `attendance_log_id uuid NOT NULL` — FK -> `attendance_logs.id`
- `employee_id uuid` — FK -> `employees.id`
- `company_id text NOT NULL`
- `ot_type text NOT NULL` — เช่น `ot15`, `ot2`, `ot3`
- `ot_hours numeric NOT NULL`
- `ot_rate_multiplier numeric` — multiplier เช่น 1.5, 2.0, 3.0
- `ot_amount numeric NOT NULL`
- `created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())`
- `updated_at timestamp with time zone`

Indexes:
- `attendance_log_id`
- `employee_id`
- `company_id`
- `ot_type`

### 3.4 `attendance_audit_logs`

Audit trail สำหรับการแก้ไข attendance

- `id uuid` — PRIMARY KEY
- `attendance_log_id uuid NOT NULL` — FK -> `attendance_logs.id`
- `company_id text NOT NULL`
- `edited_by uuid NOT NULL` — `auth.users.id`
- `edited_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())`
- `old_values jsonb NOT NULL`
- `new_values jsonb NOT NULL`
- `reason text`
- `change_type text` — เช่น `manual_override`, `correction`, `approval`, `rollback`
- `metadata jsonb`

Indexes:
- `attendance_log_id`
- `company_id`
- `edited_by`

### 3.5 `payroll_periods`

- `id uuid` — PRIMARY KEY
- `company_id text NOT NULL`
- `period_type text NOT NULL` — `daily` หรือ `monthly`
- `period_start date NOT NULL`
- `period_end date NOT NULL`
- `pay_date date`
- `status text NOT NULL DEFAULT 'draft'` — `draft`, `submitted`, `approved`, `locked`
- `created_by uuid`
- `submitted_by uuid`
- `approved_by uuid`
- `approved_at timestamp with time zone`
- `locked_at timestamp with time zone`
- `created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())`
- `updated_at timestamp with time zone`

Indexes:
- `company_id`
- `(company_id, status)`
- `(company_id, period_type)`
- `(company_id, period_start, period_end)`

### 3.6 `payroll_runs`

- `id uuid` — PRIMARY KEY
- `period_id uuid NOT NULL` — FK -> `payroll_periods.id`
- `company_id text NOT NULL`
- `run_name text`
- `run_type text` — `daily` หรือ `monthly`
- `run_date timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())`
- `total_gross_amount numeric DEFAULT 0`
- `total_deductions numeric DEFAULT 0`
- `total_net_amount numeric DEFAULT 0`
- `status text NOT NULL DEFAULT 'draft'` — `draft`, `submitted`, `approved`, `locked`
- `created_by uuid`
- `submitted_by uuid`
- `approved_by uuid`
- `approved_at timestamp with time zone`
- `locked_at timestamp with time zone`
- `created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())`
- `updated_at timestamp with time zone`

Indexes:
- `period_id`
- `company_id`
- `(company_id, status)`
- `(company_id, run_date)`

### 3.7 `payroll_lines`

- `id uuid` — PRIMARY KEY
- `payroll_run_id uuid NOT NULL` — FK -> `payroll_runs.id`
- `company_id text NOT NULL`
- `employee_id uuid NOT NULL` — FK -> `employees.id`
- `emp_id text`
- `base_salary numeric DEFAULT 0`
- `base_hours numeric DEFAULT 0`
- `worked_hours numeric DEFAULT 0`
- `overtime_hours jsonb DEFAULT '{}'` — เช่น `{ "ot15": 2, "ot2": 1, "ot3": 0 }`
- `overtime_amount numeric DEFAULT 0`
- `gross_pay numeric DEFAULT 0`
- `withholding_tax numeric DEFAULT 0`
- `absence_deduction numeric DEFAULT 0`
- `advance_deduction numeric DEFAULT 0`
- `social_security_employee numeric DEFAULT 0`
- `social_security_employer numeric DEFAULT 0`
- `other_deductions numeric DEFAULT 0`
- `net_pay numeric DEFAULT 0`
- `pay_status text NOT NULL DEFAULT 'pending'` — `pending`, `paid`, `rejected`, `locked`
- `remarks text`
- `created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())`
- `updated_at timestamp with time zone`

Indexes:
- `payroll_run_id`
- `employee_id`
- `company_id`
- `(company_id, pay_status)`

### 3.8 `payroll_line_details`

- `id uuid` — PRIMARY KEY
- `payroll_line_id uuid NOT NULL` — FK -> `payroll_lines.id`
- `company_id text NOT NULL`
- `detail_type text NOT NULL` — เช่น `base`, `ot15`, `ot2`, `ot3`, `social_security`, `advance`, `absence`, `other`
- `description text`
- `amount numeric NOT NULL DEFAULT 0`
- `quantity numeric DEFAULT 0`
- `rate numeric DEFAULT 0`
- `created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())`
- `updated_at timestamp with time zone`

Indexes:
- `payroll_line_id`
- `company_id`
- `detail_type`

### 3.9 `payroll_payslips`

- `id uuid` — PRIMARY KEY
- `payroll_line_id uuid NOT NULL` — FK -> `payroll_lines.id`
- `company_id text NOT NULL`
- `employee_id uuid NOT NULL` — FK -> `employees.id`
- `payroll_run_id uuid NOT NULL` — FK -> `payroll_runs.id`
- `payslip_number text NOT NULL UNIQUE`
- `payslip_date date NOT NULL`
- `gross_amount numeric NOT NULL DEFAULT 0`
- `deduction_amount numeric NOT NULL DEFAULT 0`
- `net_amount numeric NOT NULL DEFAULT 0`
- `payslip_url text`
- `status text NOT NULL DEFAULT 'draft'` — `draft`, `issued`, `archived`
- `created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())`
- `updated_at timestamp with time zone`

Indexes:
- `employee_id`
- `payroll_run_id`
- `company_id`

### 3.10 `payroll_rates`

- `id uuid` — PRIMARY KEY
- `company_id text NOT NULL`
- `rate_type text NOT NULL` — เช่น `ot_15`, `ot_2`, `ot_3`, `social_security_employee`, `social_security_employer`, `absence_per_day`, `absence_per_hour`
- `rate_value numeric NOT NULL`
- `rate_multiplier numeric` — สำหรับ OT rate เช่น 1.5, 2.0, 3.0
- `social_security_max_cap numeric NOT NULL DEFAULT 875`
- `effective_from date NOT NULL`
- `effective_to date`
- `created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())`

Indexes:
- `(company_id, rate_type)`
- `effective_from`
- `effective_to`

### 3.11 `payroll_ytd_summary`

- `id uuid` — PRIMARY KEY
- `company_id text NOT NULL`
- `employee_id uuid NOT NULL` — FK -> `employees.id`
- `tax_year integer NOT NULL`
- `ytd_income numeric NOT NULL DEFAULT 0`
- `ytd_social_security numeric NOT NULL DEFAULT 0`
- `ytd_tax_paid numeric NOT NULL DEFAULT 0`
- `created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())`
- `updated_at timestamp with time zone`

Unique constraint:
- `(company_id, employee_id, tax_year)`

Indexes:
- `employee_id`
- `company_id`
- `tax_year`

## 4. State Machine & Data Integrity Rules

### 4.1 State Machine: `payroll_periods`

`payroll_periods` มีสถานะหลัก:

- `draft` — สร้างและแก้ไขได้อย่างอิสระ
- `submitted` — พร้อมให้ payroll review และประมวลผล
- `approved` — ผ่านการอนุมัติแล้ว
- `locked` — ป้องกันการแก้ไขเพิ่มเติมและเป็น state สุดท้ายสำหรับรอบ payroll

Transition rules:

- `draft -> submitted` เมื่อผู้ใช้ payroll ส่งรอบให้ตรวจสอบ
- `submitted -> approved` เมื่อรอบ payroll ผ่านการอนุมัติจากผู้มีสิทธิ์
- `approved -> locked` เมื่อรอบ payroll ถูกปิดและไม่ให้แก้ไขอีก
- `submitted -> draft` อนุญาตเฉพาะ rollback โดย admin หรือ service layer ที่มีสิทธิ์พิเศษ
- `approved -> draft` หรือ `locked -> draft` ต้องมีกระบวนการ rollback/adjustment ชัดเจน และควรกำหนดให้เป็นกรณีพิเศษเท่านั้น

### 4.2 State Machine: `payroll_runs`

`payroll_runs` มีสถานะเดียวกันกับ `payroll_periods`:

- `draft` — ยังไม่รันจริง, สามารถคำนวณทดสอบได้
- `submitted` — พร้อมทบทวนยอดรวมและการหัก
- `approved` — ยืนยันยอดแล้ว
- `locked` — ห้ามแก้ไขเพิ่มเติมโดยทั่วไป

เพิ่มเติม:
- `payroll_runs` ควรมี `approved_by`, `approved_at`, `locked_at`
- เมื่อสถานะไปถึง `approved` หรือ `locked` ต้องล็อค `payroll_lines` และ `payroll_line_details` ที่เกี่ยวข้อง

### 4.3 Data Integrity Rules

- ตาราง payroll-related (`payroll_runs`, `payroll_lines`, `payroll_line_details`, `payroll_payslips`) ต้องไม่ถูกแก้ไขโดย `employee` และ `supervisor`
- `payroll` role สามารถสร้างและแก้ไขในสถานะ `draft` และ `submitted`
- `admin` role สามารถอนุมัติ, ล็อครอบ และ rollback ในกรณีพิเศษ
- เมื่อ `payroll_periods.status = 'locked'` หรือ `payroll_runs.status = 'locked'`:
  - ห้าม INSERT/UPDATE/DELETE ใน payroll tables โดย actor ปกติ
  - สามารถอ่านได้ตามสิทธิ์ที่กำหนด
- `attendance_logs` และ `attendance_summary` ที่เกี่ยวข้องกับรอบ payroll ที่ approved/locked ต้องล็อคหรือป้องกันการแก้ไข

### 4.4 Trigger / Function Spec

ระบบต้องมี trigger/function ทางฐานข้อมูลเพื่อบังคับการล็อคและรักษาความสมบูรณ์ของข้อมูล

#### 4.4.1 Trigger ใน `payroll_periods`

เมื่อ `payroll_periods.status` เปลี่ยนเป็น `approved` หรือ `locked`:

- ตรวจสอบว่า `period_start`/`period_end` ครอบคลุมช่วงเวลาที่เกี่ยวข้อง
- เรียกใช้งาน function เพื่อสั่งล็อค `attendance_logs` และ `attendance_summary` ที่อยู่ในช่วงเวลาดังกล่าวสำหรับ `company_id` เดียวกัน
- อัพเดต `locked_at` ใน `payroll_periods`

#### 4.4.2 Trigger ใน `payroll_runs`

เมื่อ `payroll_runs.status` เปลี่ยนเป็น `approved` หรือ `locked`:

- ตรวจสอบว่า `period_id` เป็นรอบที่ถูกต้อง
- สร้าง audit event หรือ log เพื่อบันทึก `approved_by`, `approved_at`, `locked_at`
- ป้องกันการแก้ไข `payroll_lines`, `payroll_line_details`, `payroll_payslips` ของ run นั้นโดย policy หรือ trigger เพิ่มเติม

#### 4.4.3 Trigger ใน `attendance_logs`

เมื่อ record `attendance_logs` ถูกเชื่อมกับ `payroll_periods` ที่ approved/locked:

- กำหนด `attendance_locked = true` หรือ `locked_at = now()`
- ป้องกันการแก้ไข `check_in`, `check_out`, `total_hours`, `ot_hours`, `weekly_ot_hours`, `weekly_ot_flagged` โดย `employee`/`supervisor`
- หากมีการแก้ไขที่ถูกต้อง ต้องสร้าง `attendance_audit_logs` พร้อม `old_values`, `new_values`, `reason`, `edited_by`

#### 4.4.4 Validation Trigger สำหรับ OT 36 ชม./สัปดาห์

เมื่อบันทึกหรืออัพเดต `attendance_logs`:

- คำนวณ `iso_week` และรวม OT ของ `employee` ในสัปดาห์นั้น
- ถ้า `weekly_ot_hours > 36` ให้ตั้งค่า `weekly_ot_flagged = true`
- สร้างบันทึก flag และห้ามอนุมัติ payroll อัตโนมัติสำหรับสัปดาห์นั้น
- อาจสร้าง `attendance_audit_logs` หรือ event log เพื่อให้ admin ตรวจสอบ

### 4.5 Integrity for `advance_payments`

- เมื่อ `advance_payments.deducted_in_payroll_run_id` ถูกตั้งค่า ต้องตรวจสอบว่า record นั้นถูกอนุมัติแล้ว
- `deducted_amount` ต้องไม่มากกว่า `amount` ของรายการเบิก
- หากมีการ rollback payroll run ที่หักเงินล่วงหน้า ต้องเคลียร์ `deducted_in_payroll_run_id` และ `deducted_amount` หรือบันทึก history ว่าถูกคืน

## 5. ข้อสรุป

`docs/payroll-migration-design.md` นี้กำหนดสเปก migration ฉบับสมบูรณ์สำหรับ PRIFF-HMS โดยรวม:

- ขยาย `employees`, `advance_payments`, `attendance_logs` ให้พร้อมใช้งาน payroll และ multi-tenant
- สร้างโครงสร้างใหม่ทั้งหมดสำหรับ identity, supervisor scope, OT detail, audit log, payroll lifecycle, payslip และ YTD tax summary
- กำหนด state machine สำหรับรอบ payroll และ run payroll
- กำหนด trigger/function spec เพื่อรักษา data integrity

เอกสารนี้พร้อมสำหรับขั้นตอนถัดไป: การเขียน SQL migration scripts ตาม specification โดยยังไม่แก้โค้ดหรือ deploy ใดๆ
