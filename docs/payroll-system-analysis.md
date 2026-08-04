# Payroll System Analysis for PRIFF-HMS

## 1. สถานะปัจจุบันของระบบ Payroll ใน Repository

### 1.1 โครงสร้างฐานข้อมูลปัจจุบัน

จากไฟล์ `database/schema.sql` และการวิเคราะห์ codebase ปัจจุบัน พบว่า:

- มีตาราง `employees` ที่เก็บข้อมูลพนักงานและค่าจ้างเบื้องต้น แต่ field ที่สัมพันธ์กับ payroll จริงยังเป็น `expected_salary` ซึ่งเป็น text และไม่ได้ถูกใช้งานแบบ structured
- มีตาราง `attendance_logs` ที่เก็บเวลาลงเข้า-ออก `check_in` / `check_out` และ `ot_hours` แต่ไม่มีการสรุปเป็นชั่วโมงปกติ, OT แยกประเภท, หรือการเก็บสัปดาห์ ISO week
- มีตาราง `advance_payments` เก็บเงินเบิกล่วงหน้า แต่ไม่ได้เชื่อมโยงกับรอบ payroll หรือใช้เป็น deduction อัตโนมัติ
- ไม่มีตาราง `payroll_runs`, `payroll_lines`, `payslips`, หรือ `payroll_ytd_summary` ใน schema ปัจจุบัน
- ไม่มีตารางสำหรับกฎ OT 1.5/2/3, ตารางอัตราประกันสังคม, หรือตารางสรุป YTD ภาษี

### 1.2 จากโค้ดปัจจุบัน

- ระบบไม่พบ module payroll calculation ใดๆ ใน `js/services` หรือ `js/pages`
- ฟังก์ชันที่เกี่ยวข้องกับเงินอยู่ที่ `expected_salary`, `salary_text` สำหรับประกาศงาน และ `advance_payments` สำหรับเงินเบิกล่วงหน้าเท่านั้น
- ฟังก์ชัน attendance มีการบันทึก `ot_hours` ใน `attendance_logs` แต่ไม่มีการแยกประเภท OT 1.5/2/3 และไม่มี validation ทางกฎหมาย
- พนักงานสามารถถ่ายรูปเช็คอิน และข้อมูลจะถูกบันทึกแบบเรียลไทม์ แต่ยังไม่มีการนำข้อมูลนี้ไปเชื่อมกับ payroll

## 2. ช่องว่างสำคัญของระบบ Payroll ปัจจุบัน

### 2.1 ข้อมูลฐานเงินเดือนไม่เพียงพอ

- `expected_salary` เป็น text ไม่ใช่ numeric
- ไม่มี field แยกประเภทเงินเดือนรายเดือน (`monthly_salary`) หรือเงินรายวัน (`daily_rate`)
- ไม่มี `hourly_rate`, `standard_working_hours`, `standard_monthly_hours`

### 2.2 ขาดโมเดล payroll run และ payslip

- ไม่มีโครงสร้างเก็บผลลัพธ์การคำนวณ payroll
- ไม่มีระบบเก็บ payslip หรือสรุป pay run
- ไม่มี audit trail สำหรับการคำนวณและอนุมัติ payroll

### 2.3 ขาดการคำนวณภาษีและ YTD

- ไม่มี field `withholding_tax` ในตาราง payroll line
- ไม่มีตารางสรุปปีต่อปีสำหรับภาษีหรือประกันสังคม
- ไม่มีการบันทึก YTD Income, YTD SSO, YTD Tax Paid เพื่อนำไปใช้ยื่น ภ.ง.ด.1ก / ภ.ง.ด.91

### 2.4 ขาดกฎหมายแรงงานไทยและการตรวจสอบ OT

- ไม่มีการตรวจสอบยอด OT 36 ชั่วโมงต่อสัปดาห์
- ไม่มีการตรวจสอบรวม OT + งานวันหยุดตามสัปดาห์ ISO week
- ไม่มีสถานะ flag หรือการเตือน admin เมื่อเกิดการละเมิดกฎหมาย

### 2.5 ระบบเงินเบิกล่วงหน้าไม่ได้เชื่อมโยงกับ payroll

- `advance_payments` มีเพียงสถานะ `pending`, `approved`, `rejected`, `paid`
- ยังไม่มีการเชื่อม `deducted_in_payroll_run_id` หรือ `deducted_amount`
- จึงไม่สามารถหักเงินเบิกล่วงหน้าอัตโนมัติในรอบ payroll ได้

## 3. ข้อกำหนดทางกฎหมายไทยที่ต้องรองรับ

### 3.1 ประกันสังคม ม.33

- ต้องหัก 5% ของฐานเงินเดือน แต่ไม่เกิน 875 บาทต่อเดือน
- ต้องเก็บ `social_security_max_cap = 875` ใน schema
- ต้องคำนวณได้ทั้งสำหรับพนักงานและนายจ้าง

### 3.2 ภาษีหัก ณ ที่จ่าย (PIT)

- ต้องคำนวณ `withholding_tax` ในแต่ละรอบ payroll
- ต้องมีฐานข้อมูลสิทธิ์ลดหย่อน เช่น จำนวนบุตรและลดหย่อนอื่นๆ
- ต้องมีการสะสมรายได้และภาษีประกันสังคมต่อปี

### 3.3 กฎหมาย OT 36 ชม./สัปดาห์

- OT รวมกับงานวันหยุดต้องไม่เกิน 36 ชั่วโมงต่อสัปดาห์ (ISO week)
- ต้องมี validation log และ flag สัปดาห์ที่เกิน
- ห้ามอนุมัติ payroll อัตโนมัติสำหรับรายการที่ flagged ก่อนตรวจสอบโดย admin

## 4. คำแนะนำเชิงปฏิบัติสำหรับการพัฒนาต่อ

### 4.1 ปรับ schema ให้เป็น payroll-ready

- ขยาย `employees` ด้วย field payroll-ready เช่น `salary_type`, `monthly_salary`, `daily_rate`, `hourly_rate`, `tax_allowance_child`, `tax_allowance_other`
- สร้างตาราง `payroll_periods`, `payroll_runs`, `payroll_lines`, `payroll_line_details`, `payroll_payslips`, `payroll_ytd_summary`
- จัดเก็บตารางกฎสำหรับ OT และ SSO

### 4.2 สร้าง layer คำนวณ payroll แยกชัดเจน

- อย่าทำการคำนวณ payroll บน client-side
- ควรใช้ Supabase Edge Function หรือ Backend Service เพื่อสรุปชั่วโมงและคำนวณ
- Payroll Engine ต้องสามารถประมวลผลทั้งรายวันและรายเดือนตามโครงสร้างเดียวกัน

### 4.3 เชื่อมจุดข้อมูล attendance เข้ากับ payroll

- ใช้ `attendance_logs` เป็น truth source สำหรับชั่วโมงทำงาน
- สร้าง Aggregator ที่สรุปชั่วโมงรายวัน/สัปดาห์/เดือน
- เพิ่ม validation OT 36 ชม./สัปดาห์

### 4.4 เชื่อม `advance_payments` กับ payroll

- เมื่อรายการเบิกเงินอนุมัติแล้ว ต้องเชื่อม `deducted_in_payroll_run_id` และ `deducted_amount`
- ลดหักใน `payroll_lines` และบันทึกเป็น `advance_deduction`

### 4.5 ทำ compliance audit trail

- เพิ่ม `approved_by`, `approved_at` ใน payroll run
- เก็บ `flagged` และเหตุผลการตรวจสอบ OT/absence
- สร้างรายงาน admin สำหรับตรวจสอบก่อนอนุมัติ payroll

## 5. ข้อสรุป

ระบบปัจจุบันของ PRIFF-HMS ยังอยู่ในระดับต้นทางสำหรับ HR/attendance และยังขาดระบบ payroll จริงอย่างชัดเจน
- ขาดข้อมูลค่าจ้างแบบ numeric
- ขาดโมเดล payroll run/payslip
- ขาด YTD tax และ SSO summary
- ขาด validation กฎหมาย OT 36 ชม./สัปดาห์

การปรับปรุงในระยะถัดไปควรเริ่มจากการสร้าง schema ที่รองรับ compliance ไทยปี 2026 พร้อม Payroll Engine ที่คำนวณ SSO, PIT, OT, advance deduction และ absence deduction อย่างชัดเจน
