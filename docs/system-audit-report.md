# รายงาน System Audit PRIFF-HMS

## 1. สถาปัตยกรรมปัจจุบัน

- เป็นระบบเว็บสถิต (Static Web App) ที่ประกอบด้วยไฟล์ HTML, CSS, JavaScript และใช้ Tailwind CSS ในการจัดสไตล์
- ไม่มีโค้ดฝั่งเซิร์ฟเวอร์ใน repository นี้ โดยทุกฟังก์ชันการทำงานเชื่อมต่อกับฐานข้อมูล Supabase ผ่านไคลเอนต์ `supabase-js` บนเบราว์เซอร์
- โครงสร้างหลักประกอบด้วย:
  - หน้า Admin: `login.html`, `dashboard.html`, `admin-employees.html`, `admin-jobs.html`, `admin-attendance.html`
  - หน้า Employee/ESS: `employee-login.html`, `employee-dashboard.html`
  - หน้า Public/Recruitment: `apply.html`, หน้าเรียกดูตำแหน่งงาน
  - โค้ดบริการและโมดูล: `js/services/*` เช่น `candidateService.js`, `jobService.js`, `cmsService.js`
  - การตั้งค่า Supabase: `js/config/supabase.js`
- การจัดเก็บข้อมูลและสื่อมีการใช้:
  - Supabase Database สำหรับตารางหลัก เช่น `employees`, `attendance_logs`, `advance_payments`, `departments`, `clients`, `system_settings`
  - Supabase Storage สำหรับ `attendance_photos`, `recruitment_files`, `public-assets`
- ระบบ build มีเพียงการคอมไพล์ CSS ด้วย Tailwind (`npx tailwindcss`) และ deploy เป็นเว็บสแตติก เช่น Vercel (`vercel.json` มีอยู่)

## 2. วิเคราะห์ระบบ Attendance

- ระบบลงเวลาแบบ Employee Self-Service (ESS) ใช้กล้องเว็บแคมหรือกล้องมือถือ + GPS จากเบราว์เซอร์
- กระบวนการลงเวลา:
  - ผู้ใช้งานเลือกไซต์งานจาก `clients`
  - ถ่ายรูปจากวิดีโอสด
  - เก็บพิกัดปัจจุบันจาก `navigator.geolocation`
  - บันทึกข้อมูลลงตาราง `attendance_logs` พร้อม `check_in` หรือ `check_out`, `status`, `photo_url`, `manual_override_reason`
- ฟีเจอร์ฝั่งแอดมิน:
  - หน้าจอ `admin-attendance.html` แสดง `attendance_logs` ทั้งหมด
  - สามารถแก้ไข `client_id` และเคลียร์สถานะธงแดง (`status` เป็น `present`)
- ประเด็นสำคัญที่พบ:
  - ระบบแยก `check_in` และ `check_out` โดยปรับตามรายการที่มีอยู่แล้ว แต่ไม่มีการจัดการกรณี `check_in` หายหรือเวลาไม่ครบ
  - ไม่มีการตรวจสอบเวลาทำงานเชิงธุรกิจ เช่น กะงาน, ช่วงเวลาทำงาน, คิวการเข้า-ออก, OT หรือการมาสายโดยอัตโนมัติ
  - การพิสูจน์ตัวตนของพนักงานใช้เพียง `emp_id` + `phone_number` เท่านั้น ซึ่งสามารถปลอมได้ง่าย
  - การเก็บข้อมูล GPS/รูปถ่ายอยู่บนฝั่งไคลเอนต์ ทำให้ spoofing, บันทึกซ้ำ, หรือแก้ไขข้อมูลได้ง่ายถ้าไม่มีการตรวจสอบเพิ่มเติม
  - การแก้ไขข้อมูลฝั่งแอดมินสำเร็จแล้วไม่มี audit trail ที่ชัดเจนในโค้ด

## 3. วิเคราะห์ความพร้อม Payroll

- ระบบมีส่วนข้อมูลของพนักงานและค่าจ้าง/เงินเดือนเบื้องต้น เช่น `expected_salary`, `salary_text`, `department_id`
- มีฟีเจอร์ `advance_payments` ที่จัดการคำขอเบิกเงินล่วงหน้าและสลิปโอนเงิน
- อย่างไรก็ตาม ระบบยังไม่รองรับ Payroll จริง:
  - ไม่มีโมดูลคำนวณเงินเดือน/ค่าจ้างรายเดือน
  - ไม่มีการคิดค่าล่วงเวลา, OT, หักภาษี, ประกันสังคม, กองทุนเงินทดแทน หรือหักรายได้อื่นๆ
  - ไม่มีการตั้ง pay period, payroll cycle หรือ batch processing สำหรับการโอนเงินเดือน
  - ปุ่ม UI เช่น `สลิปเงินเดือน` ยังเป็นหน้าตา UI แต่ไม่มีโค้ด backend/เอกสารที่สร้างสลิปจริง
  - ข้อมูลเงินเดือนยังเป็น `salary_text` เป็น string และ `expected_salary` เป็น field แบบเดียวกับข้อมูลสมัครงาน ไม่ได้เป็น schema payroll ที่ชัดเจน
- ความพร้อมโดยรวม: อยู่ในระดับต้นทางสำหรับการเชื่อมพนักงานและข้อมูลเบื้องต้น แต่ยังต้องพัฒนา Payroll Engine ใหม่และออกแบบ Data Model ให้รองรับการคำนวณจริง

## 4. ความเสี่ยงด้านความปลอดภัย

- ระบบส่วนใหญ่ทำงานจากไคลเอนต์ในเบราว์เซอร์ ซึ่งหมายความว่า logic การตรวจสอบและสิทธิ์หลายจุดอยู่บนฝั่งผู้ใช้
- ช่องโหว่สำคัญ:
  - `employee-login` ไม่ใช้รหัสผ่านและไม่ใช้ Supabase Auth; พนักงานเข้าสู่ระบบด้วย `emp_id` + `phone_number` เท่านั้น
  - session พนักงานเก็บไว้ใน `localStorage` เป็น JSON object (`priff_emp_session`) โดยไม่มีการหมดอายุหรือ token-based validation
  - ถ้า URL ของหน้า `admin-*` รั่วไหล ผู้ไม่หวังดีอาจเข้าถึงได้แม้ไม่มีการล็อกอิน เนื่องจากไม่มี guard ฝั่งหน้าเพจที่ป้องกันการเข้าถึงโดย role หรือ token อย่างชัดเจน
  - โค้ด JavaScript ทุกหน้าเข้าถึง Supabase โดยตรงผ่าน `supabaseClient` ซึ่งถ้าใช้ public key เผยแพร่คือจุดอ่อนใหญ่
  - ไม่มีการตรวจสอบ input ฝั่งเซิร์ฟเวอร์ เช่น update `attendance_logs`, `employees`, `advance_payments`, `departments`, `system_settings`
- ผลกระทบ:
  - การเข้าถึงข้อมูลพนักงานและวัน-เวลาเข้างานอาจรั่วไหล
  - ผู้ใช้ที่ไม่ใช่ admin อาจแก้ไขข้อมูลลูกค้า, พนักงาน, หรือบันทึกเวลาได้ถ้า RLS/Policies ไม่รัดกุม
  - พนักงานหรือโจมตีจากภายนอกอาจใช้ข้อมูล `emp_id`+`phone_number` เพื่อเข้าแทน

## 5. ความเสี่ยง Supabase RLS

- ใน repository ไม่มีตัวอย่างการกำหนด row-level security (RLS) หรือ policy ใดๆ ในโค้ดฝั่งไคลเอนต์
- ธรรมชาติของ Supabase client บนเบราว์เซอร์คือทุกคำสั่ง SQL ถูกเรียกผ่านคีย์เดียวกัน ดังนั้นหากไม่มี RLS ที่เหมาะสม:
  - ผู้ใช้สามารถอ่านตาราง `employees`, `attendance_logs`, `advance_payments`, `system_settings`, `departments`, `clients` ได้ทั้งหมด
  - ผู้ใช้สามารถแก้ไขตาราง `employees`, `attendance_logs`, `advance_payments`, `departments`, `system_settings` ได้ตามสิทธิ์ของคีย์
  - ฟีเจอร์ `employee-dashboard` และ `admin-*` ใช้คำสั่ง `.from(...).select('*')` และ `.update(...)` โดยไม่มีกรองที่ชัดเจนสำหรับ owner/role
- จุดเสี่ยงเฉพาะ:
  - `employee-login` ใช้ `.from('employees').select('*')` เพื่อค้นหาพนักงาน
  - `CandidateService.updateCandidateData` อัปเดต `employees` ตาม `id` และ `company_id` เท่านั้น แต่ไม่ตรวจสอบ role ว่าเป็น admin
  - `CandidateService.getAdvancePayments` และ `createAdvancePayment` เข้าถึงข้อมูล advance โดยใช้ `company_id` และ `emp_id` ผู้ใช้จริงอาจขอข้อมูลของคนอื่นได้หาก policy ไม่รัดกุม
  - `attendance_logs` ระบบ admin สามารถเรียกดูและแก้ไขทั้งหมด
- ข้อเสนอแนะแนวทาง:
  - เปิด RLS สำหรับทุกตารางสำคัญและสร้าง policy แยก `admin`, `employee`, `public`
  - ใช้ Supabase Auth สำหรับพนักงานและ admin แยก role
  - ใช้ claim จาก JWT เพื่อตรวจสอบ `emp_id`, `company_id`, `role` ก่อนอนุญาตเข้าถึง
  - ควบคุมสิทธิ์ Storage Bucket เพื่อให้พนักงานเข้าถึงเฉพาะไฟล์ของตัวเองและ admin เข้าถึง bucket audit ได้

## 6. Top 10 Technical Debt Items

1. Authentication/Authorization อ่อนแอมาก โดยเฉพาะฝั่งพนักงานที่ใช้ `emp_id` + `phone_number` และเก็บ session ใน `localStorage`
2. ไม่มี backend service หรือ API กลาง ทุก logic ถูกกระจายอยู่ใน HTML/JS ฝั่งลูกค้า ทำให้ขยายและควบคุมยาก
3. ไม่มีการกำหนด RLS/Policies ใน Supabase ซึ่งเป็นความเสี่ยงด้านข้อมูลและสิทธิ์การเข้าถึงสูง
4. Attendance validation ยังเป็นระบบพื้นฐานและเสี่ยง spoofing (GPS/รูปถ่ายบนไคลเอนต์)
5. Payroll ยังไม่ถูกออกแบบ ไม่มีการคำนวณเงินเดือน, OT, หักภาษี หรือสร้าง payslip จริง
6. ข้อมูลเงินเดือน/ค่าจ้างใช้ฟิลด์ไม่เหมาะสม (`salary_text`, `expected_salary`) และยังไม่มี schema สอดคล้องกับ payroll
7. ไม่มี unit test, E2E test หรือ pipeline ตรวจสอบคุณภาพโค้ดเลย
8. ไม่มี environment configuration ที่ชัดเจน — Supabase URL/Key ถูกจัดการในโค้ดคงที่
9. UI/UX ยังมีฟีเจอร์ที่แสดงไว้แต่ไม่สมบูรณ์หรือ stub เช่น สลิปเงินเดือน, ประวัติเวลาในหน้าพนักงาน
10. โครงสร้างโค้ดไม่มี modularization เพียงพอ — service layerบางส่วนยังเขียน logic ตรงใน page scripts จึงยากต่อการบำรุงรักษา

## 7. Recommended Roadmap for Next 90 Days

### 0-30 วัน: เสริมความปลอดภัยและวางฐานระบบ

- สร้างโครงสร้าง Auth ที่ชัดเจน
  - ติดตั้ง Supabase Auth สำหรับทั้ง admin และพนักงาน
  - แยก role: `admin`, `employee`, `hr`
  - เปลี่ยน `employee-login` ให้ใช้งานรหัสผ่านหรือ OTP แทน `emp_id`+`phone_number`
- เปิดใช้งาน Supabase RLS และสร้าง policy ขั้นต่ำ:
  - `employees` ให้พนักงานอ่าน/แก้เฉพาะข้อมูลตัวเอง
  - `attendance_logs` ให้พนักงานอ่าน/เขียนเฉพาะบันทึกตนเอง
  - `advance_payments` ให้ admin approve และพนักงานดูเฉพาะของตนเอง
- ย้ายการตั้งค่าการเชื่อมต่อ Supabase ไปยัง environment variable หรือ secret management
- รื้อระบบแอดมินให้มี guard หน้าเพจและตรวจสอบ token ก่อนโหลดข้อมูล

### 30-60 วัน: พัฒนาคุณสมบัติ HR/Payroll และ Attendance

- ออกแบบ data model สำหรับ Payroll
  - ตาราง pay_period, salary_components, payroll_runs, deductions, payslips
  - ปรับ `employees` ให้เก็บค่าจ้างจริงและ metadata payroll
- สร้าง engine คำนวณเงินเดือน และ salary slip generation
  - คำนวณ OT, สวัสดิการ, ภาษี, ประกันสังคม
  - สร้าง PDF/HTML สลิปเงินเดือนให้ดาวน์โหลด
- ขยายระบบ attendance:
  - รองรับกะงาน, ตรวจสอบมาสาย, หายบันทึก, และอนุมัติ by admin
  - เพิ่ม audit trail สำหรับแก้ไข `attendance_logs`
- พัฒนาระบบเบิกเงินล่วงหน้าให้สมบูรณ์
  - workflow ขอเบิก -> อนุมัติ -> โอน -> แนบสลิป -> ปิดรายการ

### 60-90 วัน: เสถียรภาพ, คุณภาพ และการนำไปใช้จริง

- เพิ่ม automated testing และ QA
  - สร้าง unit test สำหรับ service layer
  - สร้าง integration test / smoke test สำหรับสำคัญที่สุด
- ปรับปรุง UX/UI ให้ใช้งานได้จริง
  - ตรวจสอบ mobile responsiveness
  - ฟีเจอร์สำคัญใช้งานได้ครบ เช่น login, dashboard, attendance, advance payment
- ตรวจสอบความปลอดภัยครบถ้วน
  - ทดสอบ RLS policy, auth flow, exposure ของ bucket storage
  - ตรวจสอบความเสี่ยง XSS/CSRF และการป้องกัน input validation
- วางกระบวนการ deploy/monitor
  - ตั้ง CI ฝั่ง build และ deploy
  - ตรวจสอบ log error/exception อย่างน้อยสำหรับ admin และ attendance

## สรุป

PRIFF-HMS มีโครงสร้างต้นทางที่ดีสำหรับระบบ HR/Attendance/Recruitment แต่ยังขาดฐานความปลอดภัยและส่วน Payroll ที่แท้จริงมากที่สุด การพัฒนาใน 90 วันแรกควรเน้นไปที่:

1. สร้างการ Authenticate/Authorize ที่ถูกต้องและเปิดใช้งาน RLS
2. ปรับสถาปัตยกรรมให้ออกจากการพึ่งพา logic ฝั่งไคลเอนต์อย่างเดียว
3. ออกแบบ Payroll Data Model และเริ่มสร้างฟีเจอร์พื้นฐานก่อน
4. ปรับปรุงการจัดการ Attendance ให้เป็นระบบมากขึ้นและมี audit trail
5. วางพื้นฐาน Testing, Deployment และ Monitoring เพื่อให้ระบบพร้อมใช้งานจริง
