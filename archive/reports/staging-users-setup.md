Staging Users Setup — คู่มือการสร้างบัญชีทดสอบบน Supabase (สำหรับ RLS Testing)

วัตถุประสงค์
- สร้างบัญชีผู้ใช้ทดสอบบน Supabase Auth สำหรับ 4 บทบาท: admin, payroll, supervisor, employee
- คัดลอกค่า auth.users.id ของแต่ละบัญชีไปกรอกในตาราง user_profiles.auth_uid เพื่อให้ RLS policy ทำงานบน Staging

ข้อควรระวัง
- ทำงานบน Staging เท่านั้น ห้ามทำบน Production
- สคริปต์ migration ต้องถูกเรียกใช้ก่อน (database/01_payroll_migration_v2.sql) และตาราง user_profiles ต้องมีอยู่

ขั้นตอน
1. เข้าไปที่ Supabase Project (Staging)
   - เปิด Supabase Dashboard > Authentication > Users

2. สร้างบัญชีผู้ใช้ (แบบ Manual) สำหรับแต่ละบทบาท
   - วิธีที่ 1 (สร้างด้วย Email/Password):
     a. คลิก "New user" หรือ "Invite user (manual)" ขึ้นอยู่กับ UI
     b. กรอกข้อมูล:
        - Email: สำหรับ admin ให้ใช้ Email จริง (ตัวอย่าง: admin@kc-clean.test)
        - Password: ตั้งรหัสผ่านชั่วคราว
     c. สร้างผู้ใช้แล้วจดค่า "User ID" (auth.users.id) ที่ระบบแสดง

   - วิธีที่ 2 (สร้าง Synthetic Email สำหรับพนักงาน):
     a. กำหนด emp_id ของพนักงานเช่น "EMP001", "EMP002"
     b. สร้างบัญชีด้วย Email: EMP001@kc-clean.internal (synthetic email) และตั้งรหัสผ่าน
     c. บันทึกค่า auth.users.id ของบัญชีเหล่านี้ด้วย

3. เตรียมรายการบัญชีที่ต้องกรอกลงใน user_profiles
   - ตัวอย่างบันทึก (CSV หรือ Excel):
     role, email, auth_uid, display_name, company_id, status
     admin, admin@kc-clean.test, <uuid-from-supabase>, "Admin User", comp_kc_clean, active
     payroll, payroll@kc-clean.test, <uuid-from-supabase>, "Payroll User", comp_kc_clean, active
     supervisor, sup1@kc-clean.internal, <uuid-from-supabase>, "Supervisor 1", comp_kc_clean, active
     employee, emp001@kc-clean.internal, <uuid-from-supabase>, "Employee 1", comp_kc_clean, active

4. บันทึกค่า auth.users.id ลงในตาราง user_profiles
   - เปิด SQL Editor (Staging)
   - ตัวอย่าง INSERT (ปรับให้ตรงกับคอลัมน์ใน schema):
     BEGIN;
     INSERT INTO public.user_profiles (id, auth_uid, email, display_name, role, company_id, status, created_at)
       VALUES
       (gen_random_uuid(), '<admin-uid-here>', 'admin@kc-clean.test', 'Admin User', 'admin', 'comp_kc_clean', 'active', timezone('utc', now()));
     -- ทำซ้ำสำหรับบัญชีอื่น ๆ
     COMMIT;

   - หรือใช้ UPDATE หากแถว user_profiles ถูกเตรียมไว้แล้ว:
     UPDATE public.user_profiles SET auth_uid = '<the-uid>' WHERE email = 'admin@kc-clean.test';

5. ตรวจสอบความสมบูรณ์
   - ตัวอย่าง SQL ตรวจสอบ:
     SELECT id, auth_uid, email, role, status FROM public.user_profiles WHERE company_id='comp_kc_clean';
   - ตรวจสอบว่าแต่ละบัญชีมี auth_uid ถูกต้องและ status='active'

6. ทดสอบ RLS บน Staging
   - ใช้ Supabase Auth token ของบัญชีแต่ละบทบาท (เช่น signInWithPassword) เพื่อดึง session
   - ใช้ Session Token เพื่อลองเรียก API หรือ run SELECT queries ผ่าน client (หรือ PostgREST) และยืนยันว่า RLS ทำงานตามที่ออกแบบ
   - ตัวอย่างการทดสอบ:
     - บัญชี employee: ควรเห็นข้อมูล attendance และ payslip ของตนเองเท่านั้น
     - บัญชี supervisor: ควรเห็นข้อมูลของไซต์ที่มอบหมาย (ตรวจสอบ supervisor_client_assignments)
     - บัญชี payroll: ควรเข้าถึง payroll_runs และ payroll_lines ได้ แต่ไม่สามารถดูข้อมูลคนอื่นที่อยู่นอก company_id ได้
     - บัญชี admin: เข้าถึงได้ทุกตารางภายใต้ company_id เดียวกัน

7. บันทึกปัญหาและผู้ติดต่อฉุกเฉิน
   - หากพบปัญหา RLS หรือ auth ไม่ทำงาน ให้บันทึก User ID ที่เกี่ยวข้อง และแจ้งผู้รับผิดชอบ DB/Infra
   - Emergency contacts: (ระบุทีม Infra / DBA / Owner ที่เกี่ยวข้อง)

หมายเหตุ
- การสร้างผู้ใช้ใน Supabase Auth ไม่ได้ผูกกับข้อมูลพนักงานในตาราง employees โดยอัตโนมัติ — ต้องแน่ใจว่า user_profiles และ employees ถูกเชื่อมโยง (เช่น โดย employee_id หรือ email) ตามสเปกที่ออกแบบ
- หลังผ่านการทดสอบบน Staging สามารถเตรียมขั้นตอนสำหรับ Backfill / Provisioning อัตโนมัติสำหรับ Production ได้ แต่ต้องผ่านกระบวนการอนุมัติก่อน
