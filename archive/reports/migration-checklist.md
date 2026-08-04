# Migration Checklist: Payroll Migration สำหรับ PRIFF-HMS

เอกสารนี้สรุปขั้นตอนการเตรียมการและการตรวจสอบสำหรับการรัน SQL migration เพื่อย้ายและขยายฐานข้อมูลให้รองรับ Payroll Engine

หมายเหตุสำคัญ:
- ห้ามรันสคริปต์บน production โดยไม่ผ่านขั้นตอน backup และการทดสอบบน staging/QA
- ไฟล์ SQL ที่เกี่ยวข้อง: `database/01_payroll_migration.sql` (สร้างเป็นไฟล์เท่านั้น ณ ขั้นตอนนี้)

---

## 1. Pre-Migration Protocol (เตรียมการก่อนรัน)

1.1 สำรองข้อมูล
- Full logical dump ของฐานข้อมูลปัจจุบัน (pg_dump) และ copy ของ `database/` repository
- สำรองเฉพาะตารางสำคัญด้วย: `employees`, `attendance_logs`, `advance_payments`, `departments`, `clients`, `system_settings`
- เก็บสำเนาไฟล์ dump ไว้ใน secure location และตรวจสอบ checksum

1.2 Testing & Staging
- ติดตั้ง migration บน environment staging ที่เป็น snapshot ของ production
- รัน automated smoke tests และ sample payroll run บน staging
- ทดสอบ rollback scenario บน staging ให้มั่นใจว่าขั้นตอน rollback ทำงานได้

1.3 Checklist ข้อมูลเดิม (Data Audit)
- ตรวจสอบค่า NULL ที่สำคัญ เช่น `employees.emp_id`, `employees.phone_number`
- ระบุเรคคอร์ดที่ไม่มี `company_id` ถ้าตารางจะถูกบังคับให้มี `company_id`
- ตรวจสอบ format ของ `attendance_logs.work_date` และ `ot_hours` ที่อาจต้องแปลง
- สร้าง mapping รายการ `auth_uid` -> `employees.id` สำหรับการเชื่อม `user_profiles`

1.4 Communication
- แจ้งทีมที่เกี่ยวข้อง (DevOps, Payroll, HR, QA) ช่วงเวลา maintenance window
- ระบุ emergency contact (ชื่อ, เบอร์โทร, อีเมล) สำหรับแต่ละทีม

---

## 2. Migration Execution Order (ลำดับการรันสคริปต์)

ลำดับการรันต้องทำให้ความเสี่ยงน้อยและสามารถ rollback ได้ง่าย:

1. BEGIN TRANSACTION
2. ALTER TABLE: เพิ่มคอลัมน์ non-breaking (nullable) ใน `employees`, `advance_payments`, `attendance_logs`
3. CREATE TABLE: สร้างตารางใหม่ทั้งหมด (`user_profiles`, `supervisor_client_assignments`, `attendance_ot_details`, `attendance_audit_logs`, `payroll_periods`, `payroll_runs`, `payroll_lines`, `payroll_line_details`, `payroll_payslips`, `payroll_rates`, `payroll_ytd_summary`)
4. สร้าง INDEXes ที่จำเป็น (ไม่บล็อกการเขียนหนัก)
5. สร้าง helper functions (auth helper) และ triggers (แต่ยังไม่ผูกกับ policy ที่เข้มงวด)
6. เปิด RLS สำหรับตารางใหม่และตั้ง policy แบบ conservative (เริ่มจาก restrictive แล้วค่อยเปิดเพิ่ม)
7. ปรับค่าข้อมูลย้อนหลัง (data backfill) ใน transaction ย่อย ๆ เช่น populate `company_id`, คำนวณ `iso_week` และ `weekly_ot_hours` สำหรับ `attendance_logs` (ทำเป็น batch)
8. สร้าง triggers/constraints สำหรับ validation OT และ audit logging
9. COMMIT

หมายเหตุ:
- สำหรับการ backfill ข้อมูลขนาดใหญ่ ให้ดำเนินการเป็น batch ในช่วง maintenance window และตรวจสอบ performance
- หากการ backfill ต้องใช้เวลานาน ให้แยกเป็น transaction ย่อยและทำการตรวจสอบแต่ละขั้น

---

## 3. Post-Migration Verification (SQL Queries สำหรับสุ่มตรวจ Data Integrity)

รันตัวอย่างคำสั่งเพื่อยืนยันความถูกต้อง

3.1 ตรวจสอบคอลัมน์ใหม่ใน `employees`
SELECT id, emp_id, auth_uid, salary_type, monthly_salary, daily_rate, hourly_rate FROM public.employees LIMIT 10;

3.2 ตรวจสอบการเชื่อม `user_profiles`
SELECT up.id, up.auth_uid, up.employee_id, e.emp_id, up.role FROM public.user_profiles up LEFT JOIN public.employees e ON up.employee_id = e.id LIMIT 20;

3.3 ตรวจสอบ `attendance_logs` iso_week และ weekly flag
SELECT emp_id, work_date, iso_week, weekly_ot_hours, weekly_ot_flagged FROM public.attendance_logs WHERE weekly_ot_flagged = true LIMIT 50;

3.4 ตรวจสอบ `advance_payments` ที่ผูกกับ payroll run
SELECT id, emp_id, amount, deducted_in_payroll_run_id, deducted_amount, status FROM public.advance_payments WHERE deducted_in_payroll_run_id IS NOT NULL LIMIT 50;

3.5 ตรวจสอบความสอดคล้อง payroll_ytd_summary
SELECT employee_id, tax_year, ytd_income, ytd_social_security, ytd_tax_paid FROM public.payroll_ytd_summary WHERE ytd_income < 0 OR ytd_social_security < 0 LIMIT 20;

3.6 ตรวจสอบ RLS helper functions (ตัวอย่าง)
SELECT auth_uid, company_id, role, status FROM public.user_profiles WHERE auth_uid IS NOT NULL LIMIT 20;

3.7 ตรวจสอบ sample payroll_run และ payroll_lines
SELECT pr.id, pr.status, pl.employee_id, pl.gross_pay, pl.net_pay FROM public.payroll_runs pr JOIN public.payroll_lines pl ON pl.payroll_run_id = pr.id WHERE pr.status IN ('draft','submitted') LIMIT 20;

---

## 4. Rollback Strategy & Emergency Contacts

4.1 Rollback Strategy
- ถ้าพบปัญหา critical ระหว่าง migration ให้ทำ:
  1. ROLLBACK TRANSACTION (ถ้ายังไม่ COMMIT)
  2. หาก COMMIT แล้ว: ดำเนินการ rollback plan ดังนี้
     - กู้คืนจาก logical dump (pg_restore) ไปยัง environment staging เพื่อตรวจสอบ
     - ถ้าจำเป็น ให้ restore production DB จาก backup snapshot ก่อนหน้า
     - แจ้งทีมและเปิด incident ticket พร้อม log และ timeline การเปลี่ยนแปลง
- ระบุ checklist สำหรับ rollback: ข้อมูลที่จะใช้คืน, ระยะเวลา downtime คาดการณ์, คำสั่ง restore ที่ต้องใช้

4.2 Emergency Contacts
- DevOps / DBA: ชื่อ - เบอร์ - อีเมล
- Payroll SME: ชื่อ - เบอร์ - อีเมล
- Product Owner / Manager: ชื่อ - เบอร์ - อีเมล

(ใส่รายชื่อจริงและช่องทางติดต่อก่อนรัน script)

---

## 5. Notes & Best Practices
- สร้าง migration เป็น atomic transaction แต่แยก heavy backfill เป็น batch
- รัน migrations บน staging ก่อน production อย่างน้อยหนึ่งรอบ
- ตรวจสอบ index และ lock implications ก่อนสร้าง index ขนาดใหญ่
- เก็บ audit trail ของการรัน migration (ใครรัน, เวลา, command)

---

เอกสารนี้เป็น checklist สำหรับทีมปฏิบัติการและทีมพัฒนาในการเตรียมและรัน migration เท่านั้น — ห้ามรัน script บน production โดยไม่ผ่านขั้นตอนข้างต้น
