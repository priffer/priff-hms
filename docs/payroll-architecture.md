# Payroll Architecture สำหรับ PRIFF-HMS

## 1. บริบทและการวิเคราะห์ Codebase ปัจจุบัน

จากโค้ดปัจจุบันพบว่า:

- ระบบเป็น Static Web App ที่เชื่อมต่อ Supabase โดยตรงจากเบราว์เซอร์
- ไม่มี backend สำหรับประมวลผล payroll หรือ business logic เชิงลึก
- มีข้อมูลพนักงานในตาราง `employees`
- มีระบบ attendance recording ในตาราง `attendance_logs`
- มี feature เบิกเงินล่วงหน้าในตาราง `advance_payments`
- ข้อมูลค่าจ้างปัจจุบันยังอยู่ในรูปแบบ `expected_salary`, `salary_text` ซึ่งไม่เพียงพอสำหรับ payroll engine
- ไม่มีค่าแรงรายวัน/ชั่วโมง, ไม่มี schema สำหรับ pay period, payslip, payroll run หรือ deduction logic

จุดเริ่มต้นสำหรับ Payroll Engine จึงต้องตั้งต้นจาก data source เหล่านี้ แล้วเสริมชั้นประมวลผลที่ชัดเจน
- ต้องออกแบบให้สอดคล้องกับกฎหมายแรงงานและภาษีไทยปี 2026 โดยเฉพาะกฎประกันสังคม ม.33, ภาษีหัก ณ ที่จ่าย และข้อจำกัด OT ต่อสัปดาห์

## 2. เป้าหมายหลักของ Payroll Engine

- รองรับการจ่ายเงินทั้งแบบรายวันและรายเดือน
- รองรับ OT ตามอัตรา 1.5, 2.0, 3.0
- คำนวณประกันสังคม/SS contributions ตาม policy
- เชื่อมโยงเงินเบิกล่วงหน้าเป็นรายการหักเงินในรอบ payroll
- หักขาดงานตามกฎ โดยอิงจากวันที่ควรทำงานและการลงเวลา
- สร้าง payslip ที่ตรวจสอบได้ และเก็บประวัติ payroll run

## 3. สถาปัตยกรรมภาพรวม

### 3.1 ชั้นย่อยของระบบ

1. Frontend
   - คงไว้เป็น static web pages
   - เพิ่มหน้า Admin Payroll, Payroll Summary, Payslip Viewer
   - เรียกใช้งานผ่าน API/Edge Function แทนการคำนวณทั้งหมดบนไคลเอนต์

2. Supabase Database
   - ต่อยอดจากชุดตารางเดิม
   - เพิ่มตาราง payroll-specific เพื่อเก็บผลลัพธ์และกำหนดค่าการคำนวณ

3. Payroll Processing Layer
   - ใช้ Supabase Edge Functions หรือ Backend Service (Node/TypeScript)
   - ทำหน้าที่:
     - สรุปชั่วโมงทำงานจาก `attendance_logs`
     - คำนวณ OT, ขาดงาน, เบิกเงินล่วงหน้า, ประกันสังคม
     - สร้าง `payroll_run` และ `payslip`
     - สื่อสารกับ Supabase เพื่อเขียนผลลัพธ์และจัดเก็บ audit trail

4. Policy / RLS / Authentication
   - แยก role `admin`, `employee`, `payroll`
   - ให้พนักงานดู payslip ของตัวเองเท่านั้น
   - ให้ admin เรียกใช้งาน payroll run, ตรวจสอบรายงาน และอนุมัติ
   - ให้ payroll function อ่าน/เขียนข้อมูลตามสิทธิ์ที่รัดกุม

### 3.2 Data Flow

1. พนักงานลงเวลาใน `employee-dashboard` => บันทึก `attendance_logs`
2. ข้อมูลนิ่งใน `attendance_logs` เป็นแหล่งข้อมูลต้นทาง
3. Payroll Engine เรียก `attendance_logs` + `employees` + `advance_payments`
4. คำนวณผลลัพธ์ตาม pay period
5. สร้าง `payroll_runs`, `payroll_lines`, `payslips`
6. รายงานผลให้ admin ดูผ่าน UI และพนักงานดู payslip ผ่านหน้า ESS

## 4. แนวคิดการจัดการเงินเดือนและเงินวัน

### 4.1 การรองรับรายเดือนและรายวัน

- `salary_type` ต้องแบ่งเป็นอย่างน้อย 2 ค่า: `monthly`, `daily`
- สำหรับพนักงานรายเดือน:
  - ใช้ `monthly_salary` เป็นฐาน
  - คำนวณค่าแรงชั่วโมงจาก `monthly_salary / standard_monthly_hours`
  - กำหนด `standard_monthly_hours` เช่น 173.33 ชั่วโมง หรือค่าที่ระบบกำหนดตาม contract
- สำหรับพนักงานรายวัน:
  - ใช้ `daily_rate` เป็นฐาน
  - คำนวณค่าแรงตามวันที่ทำงานจริง

### 4.2 กฎ OT

- OT 1.5: OT หลังเวลา normal work hours เช่น ทำงานเกิน 8 ชั่วโมงในวันทำงานปกติ
- OT 2.0: OT ในวันหยุดประจำสัปดาห์หรือช่วงเวลาค่ำคืนตามนโยบาย
- OT 3.0: OT ในวันหยุดนักขัตฤกษ์หรือวันพักผ่อนที่ได้รับค่าแรงเพิ่ม
- แต่ละโทนต้องมีฐานคำนวณตาม
  - `base_hourly_rate`
  - `overtime_rate_multiplier` สำหรับประเภท OT

### 4.3 ประกันสังคม

- Payroll Engine ต้องมีตารางกฎ `social_security_rates`
- คำนวณทั้งส่วนผู้ประกันตนและผู้ประกอบการตาม policy
- ต้องรองรับกฎหมายประกันสังคม ม.33 ของไทยปี 2026 โดยใช้สูตร
  - `social_security_employee = MIN(base_salary * 0.05, 875)`
  - ซึ่งหมายความว่า หัก 5% ของฐานเงินเดือน แต่ไม่เกิน 875 บาทต่อเดือน
- เก็บค่า `social_security_max_cap` = 875 ในตาราง `payroll_rates`
- เก็บเป็นรายการหักใน payroll line
- อาจมีค่าตั้งต้นจาก `system_settings` หรือ `company_id`-specific policy

### 4.4 ระบบภาษีหัก ณ ที่จ่ายและ YTD Tax Engine

- Payroll Engine ต้องมีโมดูลภาษีบุคคลธรรมดา (PIT) ที่เก็บ cumulative year-to-date
- คำนวณ `withholding_tax` ตามรายได้สะสมและสิทธิ์ลดหย่อนของพนักงาน
- ต้องรองรับการหักภาษี ณ ที่จ่ายสำหรับรอบ payroll แต่ละรอบ
- ต้องเก็บข้อมูล `tax_allowance_child`, `tax_allowance_other`, และส่วนลดหย่อนอื่นๆ ของพนักงาน
- ต้องเชื่อมกับ `payroll_ytd_summary` เพื่อสรุป YTD Income, YTD SSO, YTD Tax Paid สำหรับใช้ยื่น ภ.ง.ด.1ก / ภ.ง.ด.91

### 4.5 เงินเบิกล่วงหน้า

- ใช้ตาราง `advance_payments` เดิมเป็นแหล่งข้อมูล
- Payroll ต้อง:
  - ตรวจสอบรายการที่อนุมัติแล้ว
  - ลดจาก `net_pay` ในรอบ payroll ที่เหมาะสม
  - เก็บรายการหักแยกเป็น `advance_deduction`

### 4.6 หักขาดงาน

- หักตามวันที่ไม่ลงเวลาและไม่อยู่ในวันลาหรือวันหยุด
- หักค่าแรงตาม `daily_rate` หรือชั่วโมงที่ขาด
- อาจมี `absence_reason`, `leave_type` เพื่อแยกไฟล์ข้อมูล

### 4.7 ตรวจสอบกฎหมายแรงงาน OT 36 ชม./สัปดาห์

- ระบบต้องตรวจสอบยอด OT รวมรายสัปดาห์ (ISO week) ตามกฎหมายไทย
- กำหนดว่า OT + งานวันหยุดรวมกันต้องไม่เกิน 36 ชั่วโมงต่อสัปดาห์
- หากสัปดาห์ใดมียอด OT เกิน 36 ชั่วโมง ให้ติด `flagged` และเตือนผู้ดูแลระบบ
- ระบบต้องห้ามอนุมัติอัตโนมัติสำหรับสัปดาห์ที่มี `flagged` เพื่อให้ admin ตรวจสอบก่อนจ่ายเงิน

## 5. การใช้งาน Payroll Engine ในระบบปัจจุบัน

### 5.1 การเปลี่ยนแปลงสำคัญที่ต้องทำ

- เสริม schema `employees` ให้มี field payroll-ready
- ออกแบบหน้า admin payroll analytics
- ติดตั้งระบบ backend / Edge Function สำหรับ calculation
- เปิด API endpoints ใหม่สำหรับ:
  - `runPayroll(periodId)`
  - `generatePayslip(empId, payrollRunId)`
  - `reviewPayrollLine(empId, payrollRunId)`
- เพิ่ม audit trail สำหรับการคำนวณและแก้ไข payroll

### 5.2 แนวปฏิบัติ

- อย่าคำนวณ payroll ทั้งหมดบน client side
- ให้ data source เช่น attendance, advance, salary เป็น truth source ใน DB
- ทำการ batch process และเก็บผลลัพธ์เสมอ เพื่อให้สามารถตรวจสอบย้อนหลังได้

## 6. Module แนะนำสำหรับ Payroll Engine

- Payroll Orchestrator
  - ควบคุม flow การคำนวณรายวัน/เดือน
  - เรียกใช้งาน module ย่อย และบันทึกผลลัพธ์
- Attendance Aggregator
  - สรุปชั่วโมงจาก `attendance_logs`
  - คำนวณ working hours, overtime, absence
- Compensation Calculator
  - คำนวณค่าแรงพื้นฐาน
  - คำนวณ OT 1.5 / 2 / 3
- Deduction Engine
  - หักเงินเบิกล่วงหน้า
  - คำนวณประกันสังคม
  - หักขาดงาน
- Payslip Generator
  - สร้าง payslip PDF/HTML
  - เขียนผลลัพธ์ลง DB
- Payroll Reporting
  - แสดง summary ให้ admin
  - พนักงานดู payslip ของตนเอง

## 7. ข้อเสนอแนะเชิงปฏิบัติ

1. เริ่มจาก data model ใหม่ก่อน แล้วตามด้วย pay rules
2. รักษาแยกชั้น: frontend, database, payroll service
3. เก็บข้อมูล `work_date`, `check_in`, `check_out`, `hours_worked`, `overtime_category` เป็น source data
4. สร้างรายงาน daily payroll และ monthly payroll แยกชัดเจน
5. วาง RLS ที่รัดกุมเพื่อป้องกันการแก้ไขตาราง payroll โดยตรงจากไคลเอนต์
