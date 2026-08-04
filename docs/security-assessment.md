# Security Assessment PRIFF-HMS

## 1. วิธี Login ของ Admin

- ใน repository ปัจจุบันมีหน้า `login.html` และสคริปต์ `js/pages/login.js`
- วิธีการ login ของแอดมินใช้ Supabase Auth ผ่านคำสั่ง `supabaseClient.auth.signInWithPassword({email, password})`
- นี่เป็นแนวทางที่ดีกว่าแบบ custom หากถูกใช้งานอย่างถูกต้อง แต่ปัจจุบันไม่มีการตรวจสอบต่อเนื่องว่า admin ได้ login ก่อนเปิดหน้า `dashboard.html` หรือ admin pages อื่นๆ
- ไม่มีหลักฐานว่า page load ของ `dashboard.html`, `admin-employees.html`, `admin-jobs.html`, `admin-attendance.html` ตรวจสอบ session หรือ role ก่อนใช้งาน
- ความเสี่ยงสำคัญคือ ถ้าแฮกเกอร์รู้ URL ของ admin page ก็สามารถเข้าถึงหน้าจอได้โดยตรง แม้จะไม่สามารถใช้งานฟังก์ชันบางส่วนได้ หากไม่มี RLS หรือ policy ฝั่งฐานข้อมูลที่รัดกุม

## 2. วิธี Login ของ Employee

- การ login ของพนักงานถูกจัดการใน `employee-login.html` และ `js/pages/employee-login.js`
- วิธี authentication ใช้การค้นหาข้อมูลในตาราง `employees`:
  - `.from('employees').select('*').eq('emp_id', empId).eq('phone_number', empPhone).single()`
- หากพบพนักงานที่ตรงกับ `emp_id` และ `phone_number` จะถือว่า login สำเร็จ

### ความเสี่ยงของ emp_id + phone_number

- `emp_id` และ `phone_number` ไม่ใช่ข้อมูลรับรองที่แข็งแรง
- เบอร์โทรศัพท์ของพนักงานสามารถถูกคาดเดาได้หรือถูกขโมยจากที่อื่น
- หากตัวเลข `emp_id` ตรงกันและเลขโทรศัพท์จับคู่ ผู้ร้ายสามารถ login เป็นพนักงานได้ง่าย
- ไม่มีการยืนยันตัวตนแบบสองปัจจัย, ไม่ตรวจสอบ OTP, ไม่ใช้รหัสผ่านหรือ token ที่ปลอดภัย
- การเข้าถึงข้อมูลพนักงานด้วยวิธีนี้ทำให้ระบบมีความเสี่ยงสูงมากกว่าการใช้ Supabase Auth ที่สามารถจัดการ token, session และ MFA ได้

## 3. การจัดเก็บ Session ใน LocalStorage

- พนักงานหลัง login จะเก็บ session ไว้ใน `localStorage` ด้วย key `priff_emp_session`
- ค่า stored เป็น JSON object ของพนักงานที่ได้จากฐานข้อมูล
- ข้อเสียสำคัญของ localStorage:
  - สามารถถูกอ่านได้จาก JavaScript ของหน้า web ใดก็ได้ในโดเมนเดียวกัน
  - เสี่ยงต่อ XSS attack หากมีช่องโหว่ในหน้าเว็บ
  - ไม่มีการหมดอายุอัตโนมัติหรือการป้องกัน replay attack
  - ข้อมูล session สามารถถูกแก้ไขได้ง่ายจากฝั่ง client
- นอกจากนี้ admin session ยังไม่ถูกจัดการในไฟล์ admin page ใดๆ ที่พบใน repository จึงไม่ชัดเจนว่ามี session persistence/expiration หรือไม่

## 4. การใช้งาน Supabase Auth และ RLS

- repository มีการใช้งาน Supabase Auth สำหรับแอดมินเพื่อ `signInWithPassword`
- แต่สำหรับพนักงานไม่ได้ใช้ Supabase Auth เลย
- ไม่มีไฟล์หรือโค้ดที่แสดงการกำหนด Row Level Security (RLS) บนฐานข้อมูลใน repository นี้
- การใช้ Supabase client-side โดยตรงต้องพึ่งพา RLS และ policies เพื่อป้องกันการเข้าถึงข้อมูลโดยไม่เหมาะสม
- ข้อสังเกต:
  - โค้ดหลายจุดใช้ `.from('employees')`, `.from('attendance_logs')`, `.from('advance_payments')`, `.from('departments')`, `.from('system_settings')` โดยตรงจากเบราว์เซอร์
  - หาก `SUPABASE_KEY` ที่ใช้ไม่ใช่ anonymous key หรือถ้า policy รั่วไหล แฮกเกอร์จะสามารถอ่าน/เขียนข้อมูลได้มาก
- สรุปคือ มีการใช้ Auth ในบางส่วน แต่ยังขาดการใช้งาน Auth แบบสอดคล้องทั้งระบบ และไม่มีหลักฐาน RLS ใน repository ทำให้น่าสงสัยว่า Access Control ยังไม่ครบถ้วน

## 5. การป้องกัน Route ของ admin pages และ API access

- ปัจจุบัน admin pages เช่น `dashboard.html`, `admin-employees.html`, `admin-jobs.html`, `admin-attendance.html` ไม่มีการตรวจสอบว่า user ได้ login หรือไม่
- ไม่มี guard ฝั่ง client ที่ตรวจสอบ token ก่อนโหลด page
- ไม่มี API layer กลางที่ป้องกันการเรียกใช้งานจากผู้ไม่หวังดี
- เส้นทางเหล่านี้อาจถูกเข้าถึงโดยตรงผ่าน URL หากไม่มี RLS/Policy ป้องกันในฐานข้อมูล
- มีฟังก์ชัน logout เพียงอย่างเดียว แต่ไม่มีการตรวจสอบในทุก page ที่สำคัญ

## 6. ความเสี่ยงของ Attendance System

### 6.1 การ Spoofing

- ระบบ attendance บันทึกข้อมูลจาก browser-side:
  - ถ่ายรูปจากกล้องเว็บแคม
  - เก็บตำแหน่ง GPS ผ่าน `navigator.geolocation`
- ข้อมูลเหล่านี้เชื่อถือไม่ได้ 100%:
  - ผู้ใช้สามารถ spoof พิกัด GPS ได้ด้วยเครื่องมือหรือ browser extension
  - ภาพถ่ายอาจถูกแก้ไขหรือแทนที่ก่อนส่ง
  - ไม่มีการตรวจสอบไทม์สแตมป์หรือรูปแบบ metadata ของภาพ
- นอกจากนี้การเก็บ `emp_id` จาก session ใน localStorage ทำให้ผู้โจมตีสามารถสวมรอยพนักงานและส่งบันทึกเวลาได้

### 6.2 Manual Override

- ฝั่ง admin มีฟีเจอร์แก้ไข `attendance_logs` และเปลี่ยนสถานะ `status` เป็น `present`
- ค่าฟิลด์ `manual_override_reason` ถูกเปลี่ยนเมื่อ admin แก้ไข แต่ไม่มี audit trail ที่จับว่าใครแก้และเมื่อไหร่
- ไม่มีการบันทึก history ของการแก้ไข ทำให้ตรวจสอบย้อนหลังได้ยาก
- ไม่มีการแยกสิทธิ์ admin ย่อย เช่น reviewer vs approver

## 7. สรุปความเสี่ยงหลัก

- Admin login อาจปลอดภัยระดับหนึ่ง แต่ route protection ยังไม่เพียงพอ
- Employee login ปัจจุบันมีความเสี่ยงสูงมากจากการใช้ `emp_id + phone_number`
- การจัดเก็บ session ใน localStorage เสี่ยงต่อ XSS และ replay
- ไม่มีหลักฐาน RLS ใน repository ซึ่งเป็นช่องโหว่สำคัญสำหรับ Supabase client-side app
- Attendance system เสี่ยง spoofing และ manual override ไม่มี audit trail

## 8. ข้อเสนอเบื้องต้น

1. ใช้ Supabase Auth ให้ครอบคลุมทั้ง admin และ employee
2. สร้าง route guard ในทุกหน้า admin และ employee
3. ลดการเก็บ session ใน localStorage โดยใช้งาน session ของ Supabase หรือ HttpOnly cookie
4. วาง RLS policy ใน Supabase สำหรับแต่ละตารางและแต่ละ role
5. เพิ่ม audit log สำหรับการแก้ไข attendance และการอนุมัติ admin
6. ตรวจสอบและยืนยันตำแหน่ง/รูปภาพ attendance บน server-side แทนเชื่อถือฝั่ง client
