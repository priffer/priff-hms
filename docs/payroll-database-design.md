# Payroll Database Design สำหรับ PRIFF-HMS

## 1. สถานะปัจจุบันของฐานข้อมูลที่พบจาก Codebase

จากโค้ดปัจจุบันพบตารางหลักที่เกี่ยวข้อง:

- `employees` — เก็บข้อมูลพนักงาน, รหัสพนักงาน, สถานะ `status`, ค่าจ้างที่ใช้ในระบบสมัครและข้อมูลเบื้องต้น
- `attendance_logs` — เก็บบันทึกลงเวลา check-in/check-out พร้อม `work_date`, `emp_id`, `client_id`, `status`, `photo_url`, `manual_override_reason`
- `advance_payments` — เก็บคำขอเบิกเงินล่วงหน้า
- `departments` — แผนก/ฝ่าย
- `clients` — รายชื่อไซต์งาน
- `system_settings` — ค่าคอนฟิกระบบทั่วไป

ข้อสังเกต:
- ไม่มี table เฉพาะสำหรับ payroll run
- ไม่มี table สำหรับ payslip, component, deduction, หรือ absence history
- ข้อมูลค่าจ้างยังไม่เพียงพอสำหรับการคำนวณจริง
- ต้องเสริม schema ให้รองรับ compliance ตามกฎหมายแรงงานและภาษีไทยปี 2026 เช่น ประกันสังคม ม.33, YTD Tax, และ OT limit 36 ชั่วโมงต่อสัปดาห์

## 2. แนวทางออกแบบฐานข้อมูล Payroll

### 2.1 หลักการออกแบบ

- แยกข้อมูล master data, transaction data, result data ให้ชัดเจน
- ให้ `attendance_logs` เป็น source ของชั่วโมงทำงาน
- ให้ `payroll_runs` เก็บผลลัพธ์ในแต่ละรอบ (daily/monthly)
- ให้ `payroll_lines` เก็บรายละเอียดค่าจ้าง/OT/หักเงินของแต่ละพนักงาน
- ให้ `payroll_components` กำหนดสูตรและประเภทของเงินได้
- บันทึก `payslips` เพื่อให้พนักงานดูย้อนหลังได้

## 3. Proposed Tables

### 3.1 employees

ขยาย schema เดิมด้วยฟิลด์ payroll-ready:

- `salary_type` (text) — `monthly` หรือ `daily`
- `monthly_salary` (numeric) — เงินเดือนต่อเดือนสำหรับพนักงานรายเดือน
- `daily_rate` (numeric) — อัตราจ้างรายวันสำหรับพนักงานรายวัน
- `hourly_rate` (numeric) — อัตราค่าจ้างต่อชั่วโมง
- `standard_working_hours` (numeric) — จำนวนชั่วโมงปกติ/วัน เช่น 8
- `standard_monthly_hours` (numeric) — ชั่วโมงปกติในเดือน เช่น 173.33
- `social_security_base` (numeric) — ฐานประกันสังคม
- `social_security_employee_rate` (numeric) — % ค่าหักพนักงาน
- `social_security_employer_rate` (numeric) — % ค่าหักบริษัท
- `tax_allowance_child` (integer) — จำนวนบุตรที่ใช้ลดหย่อนภาษี
- `tax_allowance_other` (numeric) — ลดหย่อนภาษีอื่นๆ
- `payroll_group` (text) — กลุ่ม payroll หรือ pay policy
- `is_active` (boolean) — ใช้สำหรับคำนวณ payroll

### 3.2 attendance_logs

ขยาย schema เพื่อรองรับ payroll aggregation:

- `hours_worked` (numeric) — ชั่วโมงที่คำนวณจาก check_in/check_out
- `work_hours` (numeric) — ชั่วโมงรวมจริง
- `regular_hours` (numeric) — ชั่วโมงปกติ
- `overtime_hours` (jsonb) — รายละเอียด OT แต่ละประเภท เช่น {"ot15": 2, "ot2": 1, "ot3": 0}
- `absence_type` (text) — `absent`, `sick_leave`, `paid_leave`, `holiday`
- `attendance_status` (text) — `present`, `absent`, `flagged`
- `attendance_notes` (text) — หมายเหตุเพิ่มเติม

### 3.3 payroll_periods

เก็บช่วงเวลาที่จะประมวลผล payroll:

- `id`
- `company_id`
- `period_type` (text) — `daily` หรือ `monthly`
- `period_start` (date)
- `period_end` (date)
- `pay_date` (date)
- `status` (text) — `draft`, `processing`, `completed`, `approved`
- `created_at`, `updated_at`

### 3.4 payroll_runs

- `id`
- `period_id` (fk -> payroll_periods.id)
- `company_id`
- `run_name` (text)
- `run_type` (text) — `daily`, `monthly`
- `run_date` (timestamp)
- `total_gross_amount` (numeric)
- `total_deductions` (numeric)
- `total_net_amount` (numeric)
- `status` (text) — `pending`, `completed`, `locked`
- `created_by` (uuid/text)
- `approved_by` (uuid/text)
- `approved_at` (timestamp)

### 3.5 payroll_lines

เก็บค่าจ้างรายละเอียด per employee ต่อรอบ payroll:

- `id`
- `payroll_run_id` (fk -> payroll_runs.id)
- `emp_id` (text)
- `employee_id` (uuid) หรือ reference ไป `employees.id`
- `base_salary` (numeric)
- `base_hours` (numeric)
- `worked_hours` (numeric)
- `overtime_hours` (jsonb)
- `overtime_amount` (numeric)
- `gross_pay` (numeric)
- `withholding_tax` (numeric)
- `absence_deduction` (numeric)
- `advance_deduction` (numeric)
- `social_security_employee` (numeric)
- `social_security_employer` (numeric)
- `other_deductions` (numeric)
- `net_pay` (numeric)
- `pay_status` (text) — `pending`, `paid`, `rejected`
- `remarks` (text)

### 3.6 payroll_line_details

เก็บรายการรายละเอียดย่อยของแต่ละ payroll line:

- `id`
- `payroll_line_id` (fk -> payroll_lines.id)
- `detail_type` (text) — `base`, `ot15`, `ot2`, `ot3`, `social_security`, `advance`, `absence`, `other`
- `description` (text)
- `amount` (numeric)
- `quantity` (numeric)
- `rate` (numeric)

### 3.7 payroll_payslips

เก็บเมตาดาต้าสำหรับ payslip ที่พนักงานสามารถดูได้:

- `id`
- `payroll_line_id` (fk -> payroll_lines.id)
- `employee_id`
- `payroll_run_id`
- `payslip_number` (text)
- `payslip_date` (date)
- `gross_amount` (numeric)
- `deduction_amount` (numeric)
- `net_amount` (numeric)
- `payslip_url` (text) — ถ้ามีไฟล์ PDF/HTML เก็บลิงก์
- `status` (text) — `draft`, `issued`, `archived`
- `created_at`, `updated_at`

### 3.8 payroll_rates

เก็บอัตรา OT, ประกันสังคม, ค่าหักขาดงาน:

- `id`
- `company_id`
- `rate_type` (text) — `ot_15`, `ot_2`, `ot_3`, `social_security_employee`, `social_security_employer`, `absence_per_day`
- `rate_value` (numeric)
- `social_security_max_cap` (numeric) — ค่าตั้งต้น 875 บาท ตามกฎหมาย ม.33
- `effective_from` (date)
- `effective_to` (date)

### 3.9 payroll_ytd_summary

เก็บยอดสะสมรายปีสำหรับภาษีและประกันสังคม (เทียบเท่า tblYTDTax ใน Excel):

- `id`
- `company_id`
- `employee_id`
- `tax_year` (integer)
- `ytd_income` (numeric)
- `ytd_social_security` (numeric)
- `ytd_tax_paid` (numeric)
- `created_at` (timestamp)
- `updated_at` (timestamp)

### 3.10 attendance_summary

สรุปข้อมูล attendance ต่อรอบ payroll:

- `id`
- `employee_id`
- `payroll_period_id`
- `total_workdays` (integer)
- `present_days` (integer)
- `absent_days` (integer)
- `paid_leave_days` (integer)
- `unpaid_leave_days` (integer)
- `total_regular_hours` (numeric)
- `total_overtime_hours` (numeric)
- `total_ot15_hours` (numeric)
- `total_ot2_hours` (numeric)
- `total_ot3_hours` (numeric)
- `weekly_ot_flagged` (boolean) — ตรวจสอบ OT เกิน 36 ชม./สัปดาห์
- `total_absence_deduction` (numeric)

### 3.11 advance_payments (ปรับปรุง)

ปรับ schema ของตารางนี้เพื่อรองรับ payroll deduction:

- `id`
- `emp_id`
- `company_id`
- `amount`
- `request_date`
- `status` — `pending`, `approved`, `rejected`, `paid`
- `transfer_slip_url`
- `approved_at`
- `approved_by`
- `deducted_in_payroll_run_id` (fk -> payroll_runs.id)
- `deducted_amount` (numeric)
- `remarks`

## 4. Relationship ของตาราง

- `employees` 1:N `attendance_logs`
- `employees` 1:N `payroll_ytd_summary`
- `payroll_periods` 1:N `payroll_runs`
- `payroll_runs` 1:N `payroll_lines`
- `payroll_lines` 1:N `payroll_line_details`
- `payroll_lines` 1:1 `payroll_payslips`
- `payroll_periods` 1:N `attendance_summary`
- `advance_payments` -> `payroll_runs` เมื่อรายการถูกหักเงิน

## 5. การใช้งานจริงกับ requirement

### 5.1 รายวัน

- สร้าง `payroll_periods` ที่มี `period_type = daily`
- รัน payroll สำหรับแต่ละ `work_date`
- ใช้ `daily_rate` และ `attendance_logs.hours_worked`
- คำนวณ OT และหักขาดงานตามการเข้าออกในวันเดียวกัน

### 5.2 รายเดือน

- สร้าง `payroll_periods` ที่มี `period_type = monthly`
- สรุปชั่วโมงและรายได้ตาม `attendance_summary`
- คำนวณเงินเดือนพื้นฐานจาก `monthly_salary`
- คำนวณ OT บนฐานชั่วโมงรายเดือน และรวมกับรายได้พื้นฐาน

### 5.3 OT 1.5 / 2 / 3

- ใช้ตาราง `payroll_rates` เพื่อเก็บ multiplier
- สร้างรายการ `payroll_line_details` แยกประเภท OT
- คำนวณผลรวม OT ตามประเภทและ rate

### 5.4 ประกันสังคม

- ใช้ `payroll_rates` สำหรับอัตรา
- เก็บทั้งส่วนพนักงานและนายจ้าง
- ต้องรองรับกฎหมาย ม.33 โดยใช้ `social_security_max_cap` = 875 บาท
- บันทึกเป็น `payroll_line_details` และสรุปใน `payroll_lines`

### 5.5 เงินเบิกล่วงหน้า

- เชื่อม `advance_payments` เข้ากับ `payroll_runs`
- บันทึก `deducted_in_payroll_run_id` เมื่อหักจริง
- ใช้ `advance_deduction` ใน `payroll_lines`

### 5.6 หักขาดงาน

- สร้าง `absence_per_day` หรือ `absence_per_hour` ใน `payroll_rates`
- เมื่อพบ `absent_days` ใน `attendance_summary` ให้หักเงินตามอัตราที่กำหนด
- เก็บรายละเอียดเป็น `absence` ใน `payroll_line_details`
- หาก `attendance_summary.weekly_ot_flagged` เป็น `true` ให้ขึ้นเตือน admin และห้ามอนุมัติรอบ payroll โดยอัตโนมัติจนกว่าจะตรวจสอบแล้ว

## 6. ข้อเสนอเชิงปฏิบัติ

- หากต้องการลดความซับซ้อนระยะแรก ให้เริ่มจาก model:
  - `employees`, `attendance_logs`, `payroll_periods`, `payroll_runs`, `payroll_lines`, `payroll_line_details`
- เสริมด้วย `payroll_rates`, `payroll_payslips`, `attendance_summary` เมื่อระบบเริ่มใช้งานจริง
- รักษาข้อมูล master data และผลลัพธ์ payroll แยกจากกัน เพื่อให้สามารถตรวจสอบย้อนหลังและ rollback ได้
- ออกแบบ schema ให้รองรับทั้ง daily payroll และ monthly payroll โดยไม่ต้องสร้าง engine 2 ชุดแยกจากกัน
