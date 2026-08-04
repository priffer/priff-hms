# Auth Redesign PRIFF-HMS

เป้าหมายการออกแบบใหม่ของระบบ Authentication และ Authorization:
- ให้แยกบทบาท (role) ระหว่าง Admin กับ Employee
- ใช้ Supabase Auth อย่างสอดคล้องทั้งระบบ
- ลดความเสี่ยงจากการเก็บ session ใน LocalStorage
- ป้องกันการเข้าถึง route และข้อมูลด้วย RLS
- เพิ่มความปลอดภัยของ Attendance System และการแก้ไขข้อมูล

## 1. แนวทางหลักของระบบใหม่

1.1 ใช้ Supabase Auth ทั้งหมด
- แอดมินและพนักงานต้องมี account ใน Supabase Auth
- แอดมินใช้ email/password หรือ SSO ถ้าต้องการ
- พนักงานควรใช้บัญชีที่มีการยืนยันตัวตน เช่น password, OTP, หรือ passwordless login

1.2 แยก role ระดับผู้ใช้งาน
- Role `admin`
- Role `employee`
- ถ้าจำเป็น อาจมี role ย่อยเช่น `attendance_manager`, `payroll_officer`, `hr_viewer`
- เก็บ role เป็น custom claim ใน JWT หรือ metadata ของ user record

1.3 ห้ามใช้ `emp_id + phone_number` เป็น auth credential
- `emp_id` และ `phone_number` สามารถเก็บเป็นฟิลด์ข้อมูลพนักงาน แต่ไม่ควรใช้เป็นรหัสผ่านหรือวิธี login หลัก
- หากต้องการให้พนักงานใช้หมายเลขพนักงานเป็น username ให้จับคู่กับรหัสผ่านหรือ OTP
- ตัวอย่างที่ปลอดภัยขึ้น:
  - `username = emp_id`, password แบบ secure
  - หรือ passwordless OTP via email/SMS ที่ยืนยันตัวตนจริง

## 2. การจัดการ session และ token

2.1 เลิกใช้ LocalStorage สำหรับ session สำคัญ
- ห้ามเก็บ token หรือ session object ใน `localStorage`
- หากต้องการเก็บ session บน client ให้ใช้ Supabase Auth client-side session mechanism
- หากมี backend หรือ Edge Function ให้เก็บ cookie เป็น HttpOnly และ Secure

2.2 หากเป็น Single Page Application
- ใช้ Supabase client เพื่อจัดการ session และ refresh token
- ตรวจสอบ `supabase.auth.getSession()` ในทุก page ที่สำคัญ
- เมื่อ logout ให้เรียก `supabase.auth.signOut()` และล้าง state ฝั่ง client

2.3 บังคับ session timeout และ refresh
- ไม่ควรให้ session อยู่ได้นานเกินไปโดยไม่รีเฟรช
- ตั้งค่า `access token` และ `refresh token` อย่างเหมาะสมใน Supabase

## 3. Route protection และ page guard

3.1 ป้องกัน admin route ใน frontend
- ทุกหน้า admin ต้องตรวจสอบ session ก่อน render
- ถ้าไม่มี session หรือ role ไม่ใช่ `admin` ให้ redirect ไปหน้า login
- ตัวอย่าง logic:
  - โหลด `supabase.auth.getSession()`
  - ตรวจสอบ `user` และ `user.app_metadata.role`
  - ถ้าไม่ตรง ให้ `window.location.href = '/login.html'`

3.2 ป้องกัน employee route ใน frontend
- หน้า employee dashboard/attendance ต้องตรวจสอบ session และ role `employee`
- หาก user เป็น admin แต่ไม่ได้รับสิทธิ์ employee ไม่ควรเข้าถึงหน้าพนักงาน

3.3 ป้องกัน API access
- หากมี Edge Function หรือ backend ให้ยืนยัน token ทุกครั้ง
- หากไม่มี backend ให้ใช้ RLS policy ใน Supabase และตรวจสอบ `auth.uid()`

## 4. Supabase RLS และ Access Control

4.1 กำหนด RLS policy สำหรับตารางสำคัญ
- ตาราง `employees`
  - employee role อ่าน/เขียนเฉพาะ record ของตัวเอง
  - admin role อ่าน/เขียนได้ตามสิทธิ์ที่กำหนด
- ตาราง `attendance_logs`
  - employee role เขียน record ของตัวเองและอ่านเฉพาะของตัวเอง
  - admin role อ่าน/เขียนได้ตามสาขาหรือบริษัท
- ตาราง `advance_payments`, `payroll_lines`, `payroll_ytd_summary`
  - employee role อ่านเฉพาะของตนเอง
  - admin role อ่าน/จัดการได้ตามสิทธิ์

4.2 ใช้ custom claims เพื่อบังคับสิทธิ์
- เก็บ role ใน user metadata เช่น `app_metadata: { role: 'employee' }`
- หากต้องการแยกบริษัท หรือ business unit ให้เก็บ `company_id` หรือ `tenant_id`
- RLS policy ใช้ `auth.role()` และ `auth.jwt() -> claims`

4.3 จำเป็นต้องมี service layer ถ้าต้องการฟังก์ชันพิเศษ
- หากต้องการให้ attendance validation หรือ payroll processing มีเงื่อนไขพิเศษ ควรพัฒนา backend/Edge Function
- หลีกเลี่ยงการวาง logic สำคัญทั้งหมดบน client-side

## 5. การออกแบบ Authentication Workflow ใหม่

5.1 สำหรับ Admin
- Login ด้วย email/password ผ่าน Supabase Auth
- ตอนสร้างบัญชี ให้กำหนด role `admin`
- เมื่อ login สำเร็จ ให้ตรวจสอบ role และบันทึก session จาก Supabase
- หน้า admin ต้องเรียก `supabase.auth.getSession()` ทุกครั้งก่อนโหลดข้อมูลสำคัญ

5.2 สำหรับ Employee
- สร้างระบบ login ที่แยกจากการค้นหา `employees` table
- ใช้ Supabase Auth เพื่อสร้าง account ให้พนักงาน
- ทางเลือกการ login ที่ปลอดภัย:
  - username/password โดยใช้ `emp_id` เป็น username
  - passwordless OTP ผ่านอีเมลหรือ SMS
  - social login ถ้าจำเป็น
- หลัง login ให้บันทึก `user.id` เป็น UID ของ Supabase แทน `emp_id` ใน session
- `employees` table จะเชื่อมกับ Supabase user account ผ่าน `auth_uid` หรือ `user_id`

5.3 หากยังต้องใช้ `employee_id`
- เก็บ `emp_id` แยกจากรหัสผ่าน
- อย่าใช้ `phone_number` เป็น credential หลัก
- หากใช้งานเบอร์โทรศัพท์ ให้ใช้เป็นช่องข้อมูลติดต่อและยืนยันเหมือนช่องข้อมูลทั่วไป

## 6. การป้องกันการเข้าถึงและสิทธิ์การใช้งาน

6.1 เก็บ role และ company context ในระบบ
- `user` record ควรมี metadata เช่น:
  - `role` (admin, employee, hr, payroll)
  - `company_id` / `tenant_id`
  - `employee_db_id` หรือ `employee_uuid`
- ใช้ metadata เหล่านี้ใน RLS policy เพื่อป้องกัน cross-tenant access

6.2 จำกัด admin page ตาม role
- หน้า `admin-employees` เข้าถึงได้เฉพาะ `admin` และ `hr`
- หน้า `admin-payroll` เข้าถึงได้เฉพาะ `payroll_officer` หรือ `admin`
- หน้า `attendance-review` เข้าถึงได้เฉพาะ `attendance_manager` หรือ `admin`

6.3 ตรวจสอบค่าฐานข้อมูลเพิ่มเติม
- เมื่อ admin สร้าง/แก้ไข user ให้ตรวจสอบว่า role และ company ถูกต้อง
- ห้ามให้ user สร้างหรือแก้ role เองจาก client-side

## 7. การแก้ปัญหา Attendance และ Spoofing

7.1 บันทึก audit trail ของการแก้ไข
- เมื่อมี `manual_override_reason` ต้องบันทึก:
  - ผู้แก้ไข (admin UID)
  - เวลาแก้ไข
  - ค่าเดิมและค่าใหม่
- ควรมีตาราง `attendance_audit_logs` หรือ history log

7.2 ลดความเชื่อใจจาก client
- หากเป็นไปได้ ให้ย้ายการตรวจสอบตำแหน่งหรือรูปภาพไปยังบริการ server-side
- ใช้ signed URL และตรวจสอบ image metadata เพื่อยืนยันแหล่งที่มา
- กำหนดสิทธิ์การส่งข้อมูลเฉพาะ user ที่ authenticated

7.3 หากต้องใช้ manual override
- ให้มี workflow อนุมัติสองชั้น (approval/review)
- ไม่อนุญาตให้ admin ใดๆ แก้ไขโดยไม่มีหลักฐานหรือเหตุผลชัดเจน

## 8. สรุปข้อเสนอ

- ใช้ Supabase Auth สำหรับทั้ง admin และ employee
- ห้ามใช้ `emp_id + phone_number` เป็น credential หลัก
- ป้องกัน route ทุกหน้าและตรวจสอบ session ก่อนโหลดข้อมูล
- ติดตั้ง RLS policy อย่างครอบคลุมสำหรับทุกตารางที่มีข้อมูลสำคัญ
- เปลี่ยนการจัดเก็บ session จาก `localStorage` ไปเป็น mechanism ที่ปลอดภัยกว่า
- เพิ่ม audit log สำหรับ attendance manual override และการแก้ไขข้อมูลสำคัญ

เอกสารฉบับนี้ออกแบบเพื่อให้ระบบ PRIFF-HMS มี Authentication และ Authorization ที่รัดกุมขึ้น โดยยังคงสามารถใช้งาน Supabase เป็น backend ได้อย่างปลอดภัยมากขึ้นในระยะยาว