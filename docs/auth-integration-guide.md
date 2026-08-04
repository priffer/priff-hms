เอกสาร Auth Integration Guide — PRIFF-HMS

ภาพรวม
- ใช้ Supabase Auth เป็นแหล่งยืนยันตัวตนหลัก (primary auth).
- ใช้ user_profiles เป็น Single Source of Truth (SSOT) สำหรับบทบาท (role) และ company_id.
- ห้ามใช้ session ที่เก็บใน localStorage (เช่น priff_emp_session) อีกต่อไป — ให้เรียกใช้ supabase.auth.getSession() ทุกครั้ง.
- มีไฟล์ JavaScript ที่ต้องติดตั้งบนหน้าเว็บ:
  - js/auth/login.js (Synthetic Email Login)
  - js/auth/auth-guard.js (requireAuth และ helper functions)

การติดตั้ง (ตัวอย่าง)
1. เพิ่มสคริปต์ Supabase client (ตามเวอร์ชันที่ใช้งาน) ใน <head> หรือก่อนปิด </body> ของแต่ละหน้า:

<script src="/path/to/supabase-client.js"></script>
<script src="/js/auth/auth-guard.js"></script>
<script src="/js/auth/login.js"></script>

2. ตัวอย่างการป้องกันหน้าเพจ (inline script ในแต่ละหน้า)

<!-- ป้องกันหน้าสำหรับผู้ดูแลระบบเท่านั้น -->
<script>
  (async () => {
    const ok = await window.PriffAuthGuard.requireAuth(['admin']);
    if (!ok) return; // requireAuth จะทำ redirect หากไม่ผ่าน
    // ถัดไปโหลดข้อมูลหน้าได้ตามปกติ
  })();
</script>

3. ตัวอย่างสำหรับหน้าเข้าถึงได้หลายบทบาท
<script>
  (async () => {
    const ok = await window.PriffAuthGuard.requireAuth(['admin','payroll']);
    if (!ok) return;
  })();
</script>

แนวปฏิบัติที่ต้องปฏิบัติ
- ห้ามอ่าน/เขียน localStorage.getItem('priff_emp_session') หรือสำรอง session ใน localStorage
- ให้ใช้ Supabase session ที่ถูกต้องและตรวจสอบสถานะ user_profiles.status === 'active'
- ห้ามแก้ไขไฟล์ HTML เดิมจนกว่า Staging DB Verification จะสำเร็จตามนโยบาย
- เจ้าหน้าที่ frontend ต้องรอให้ระบบ Supabase Auth และ user_profiles ถูกติดตั้งใน Staging ก่อนทำการทดสอบ RLS

Permission Mapping (ตัวอย่างมาตรฐาน)
- /dashboard.html: ['employee','supervisor','payroll','admin']
- /admin-employees.html: ['admin']
- /admin-departments.html: ['admin']
- /payroll-run.html: ['payroll','admin']
- /payroll-payslip.html: ['employee','payroll','admin'] (แต่ employee จะได้รับผลลัพธ์เฉพาะข้อมูลของตนผ่าน RLS)
- /attendance.html: ['employee','supervisor','admin'] (employee ดูของตนเอง, supervisor ดูของไซต์ที่ถูกมอบหมาย)
- /advance-payments.html: ['employee','payroll','admin']

หมายเหตุสำคัญ
- การป้องกันหน้าด้วย requireAuth เป็นเพียงชั้นแรกในการป้องกัน UI เท่านั้น — ต้องออกแบบ RLS บนฐานข้อมูลเพื่อป้องกันการโจมตีจาก API/Direct DB access
- frontend ต้องไม่พยายามแก้ไขสิทธิ์บน client-side เพื่อให้หน้าทำงาน — ทุกการตรวจสอบการเข้าถึงข้อมูลเชิงลึกต้องพึ่ง RLS และ backend checks

การใช้งาน Synthetic Email Login
- login.js จะเปลี่ยน emp_id เป็นอีเมลปลอมในรูปแบบ: <emp_id>@kc-clean.internal
- เมื่อ provision ผู้ใช้ใน Supabase Auth ให้สร้างบัญชีโดยใช้ synthetic email ดังกล่าว และตั้งรหัสผ่านที่พนักงานจะใช้ (หรือใช้ Magic Link / OTP ตามนโยบาย)
- หลัง provisioning ให้กรอกค่า user_profiles.auth_uid เป็น auth.users.id ที่แท้จริง เพื่อให้ RLS ทำงาน (auth_uid เป็น SSOT อยู่ใน user_profiles)

ตรวจสอบและทดสอบ
- ทดสอบทุกหน้าใน Staging ด้วยบัญชีผู้ใช้แต่ละบทบาท (admin, payroll, supervisor, employee)
- ทดสอบการเข้าถึง API/CRUD โดยใช้ token ของแต่ละบทบาท
- ยืนยันว่าผู้ใช้ employee ไม่สามารถเข้าถึงข้อมูลเพื่อนร่วมงานโดยตรงผ่าน API (ทดสอบ SELECT/UPDATE/DELETE)

การผสานกับระบบปัจจุบัน
- อย่าแก้ไขไฟล์ HTML เดิมจนกว่าจะผ่าน Staging DB Verification
- หากหน้าใดใช้ localStorage ในปัจจุบัน ให้ลบโค้ดนั้นในสเตจถัดไปและเปลี่ยนเป็นเรียกใช้งานผ่าน Supabase client และ requireAuth

ติดต่อสำหรับช่วยเหลือ
- หากต้องการตัวอย่างการติดตั้งสำหรับหน้าเฉพาะ แจ้งชื่อไฟล์ HTML และทีมจะจัดตัวอย่าง inline script ให้
