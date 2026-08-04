RLS Verification Checklist — Staging (คู่มือสำหรับ DBA/Tester)

วัตถุประสงค์
- ตรวจสอบและยืนยันว่า RLS Policies และ Permission Matrix ที่ออกแบบใน migration v2 ทำงานตามที่คาดหวังบน Staging
- ให้กระบวนการชัดเจนสำหรับการรัน migration, seed, provisioning ผู้ใช้ และการรันชุดทดสอบ RLS

ข้อควรระวังก่อนเริ่ม
- ห้ามรันบน Production
- ตรวจสอบว่าไฟล์ migration v2 (database/01_payroll_migration_v2.sql) และ seed (database/02_seed_staging_data.sql) ถูกทดสอบใน environment แยกก่อน
- เตรียมบัญชีทดสอบ (admin, payroll, supervisor, employee) และบันทึกค่า auth.users.id ของแต่ละบัญชี

ขั้นตอนการทดสอบ (Step-by-step)

1) สร้าง Snapshot / Backup ของ Staging
   - ทำ snapshot หรือ backup ก่อนทุกครั้ง (DB dump หรือ Supabase backup)
   - จด timestamp และชื่อ snapshot ไว้ในบันทึกการทดสอบ

2) รัน Migration v2
   - รันไฟล์: database/01_payroll_migration_v2.sql บน Staging
   - ตรวจสอบว่าไม่มีข้อผิดพลาด และตารางสำคัญถูกสร้างขึ้น: user_profiles, supervisor_client_assignments, payroll_runs, payroll_lines, payroll_payslips, payroll_rates, payroll_ytd_summary, attendance_ot_details, attendance_audit_logs เป็นต้น

3) รัน Seed Data (ตัวอย่าง)
   - รันไฟล์: database/02_seed_staging_data.sql (หรือ seed ที่ทีม DBA เตรียม)
   - ตรวจสอบว่าสร้างข้อมูลตัวอย่างของ company_id = 'comp_kc_clean' สำเร็จ (employees, clients, supervisor assignments, sample attendance)

4) Provision Supabase Auth Users (Staging)
   - สร้างบัญชีผู้ใช้ใน Supabase Auth Dashboard ดังนี้:
     * admin (email จริง)
     * payroll (email จริง)
     * supervisor (synthetic email เช่น sup1@kc-clean.internal)
     * employee (synthetic email เช่น emp001@kc-clean.internal)
   - บันทึกค่า auth.users.id ของแต่ละบัญชี
   - อัปเดตตาราง user_profiles.auth_uid ด้วยค่า auth.users.id ที่ได้ (INSERT หรือ UPDATE ตามการเตรียม seed)
     - ตัวอย่าง SQL: UPDATE public.user_profiles SET auth_uid = '<ADMIN_UID>' WHERE email = 'admin@...';

5) ตรวจสอบ Helper Functions (RLS helpers)
   - ยืนยันว่า helper functions ถูกสร้าง (auth.get_user_profile_id(), auth.get_user_company(), auth.get_user_role(), auth.is_active_user())
   - ตรวจสอบว่า helper functions เป็น SECURITY DEFINER (ตามนโยบาย final)

6) เตรียมบัญชีทดสอบและ JWT
   - ใช้ Supabase client (หรือ PostgREST) เพื่อ signIn ด้วยบัญชีทดสอบแต่ละบัญชี
   - เก็บ JWT / session ของแต่ละบัญชีไว้เพื่อนำมาใช้ในขั้นตอนทดสอบ (หรือใช้งานผ่าน UI ที่ล็อกอินเป็นบัญชีทดสอบ)

7) รันชุดทดสอบ RLS (database/03_test_rls_policies.sql)
   - วิธีการรัน:
     a) สำหรับแต่ละบล็อก (Employee / Supervisor / Payroll / Admin): ให้ล็อกอินเป็นบัญชีทดสอบที่สอดคล้อง แล้วรันแต่ละ query ใน context ของ session นั้น
     b) บันทึกผลลัพธ์ (rows returned, rows_affected)
     c) รัน block ของ Admin (ground truth) เพื่อเปรียบเทียบ
   - ตัวอย่าง flow (Employee test):
     1. SignIn เป็น emp001 -> รับ JWT
     2. ใช้ PostgREST / Supabase client หรือแอปทดสอบที่ส่ง Authorization: Bearer <JWT> เพื่อเรียก query block ของ Test 1
     3. เก็บผลลัพธ์และเปรียบเทียบกับ Admin ground truth

8) คำตรวจสอบที่ต้องยืนยัน (Acceptance Criteria)
   - Employee:
     * SELECT attendance_logs คืนข้อมูลเฉพาะแถวที่ emp_id = ของผู้ใช้เท่านั้น
     * SELECT payroll_payslips คืนสลิปเฉพาะของผู้ใช้
     * UPDATE/DELETE แถวของผู้อื่นต้องถูกปฏิเสธ (rows_affected = 0 หรือ error ตาม policy)
   - Supervisor:
     * SELECT attendance_logs คืนข้อมูลเฉพาะ client_id ที่มอบหมายเท่านั้น
     * Supervisor ไม่สามารถเข้าถึง payroll_runs/payslips ได้ (ไม่มีผลลัพธ์ หรือ access denied)
   - Payroll:
     * สามารถ SELECT/INSERT/UPDATE ตาราง payroll_* ได้ภายใน company_id
     * ไม่สามารถเข้าถึง attendance_logs ของ company อื่นได้
   - Admin:
     * สามารถ SELECT/UPDATE ทุกข้อมูลภายใน company_id เดียวกันได้

9) ถ้าพบปัญหา
   - บันทึกข้อผิดพลาดเต็ม (SQL, error message, JWT used, user_profiles row for that auth_uid)
   - ตรวจสอบ helper functions และ policies ที่เกี่ยวข้อง (เช่น policy ที่อ้าง helper functions)
   - หากเป็นปัญหา policy ผิดพลาด ให้ทำการแก้ไขใน staging branch และรันซ้ำชุดทดสอบ

10) Post-Test Cleanup
   - หากมีการ INSERT/UPDATE ทดสอบที่ไม่ได้ rollback ให้ทำ cleanup โดย Admin (หรือ restore snapshot หากจำเป็น)
   - สรุปผลการทดสอบ เก็บเป็น artifacts: SQL outputs, screenshots, notes

11) รายงานผล
   - สรุปในเอกสารการทดสอบว่าแต่ละ Test Passed / Failed พร้อมหลักฐาน (query output)
   - หาก Passed 100% ให้อนุมัติ Milestone ต่อไป (ตามมติ AI Architecture Board)

แนวทางการอัตโนมัติ (แนะนำ)
- สร้างสคริปต์ทดสอบแบบอัตโนมัติ (Node.js/Python) ที่:
  1) signIn แต่ละบัญชี, เก็บ JWT
  2) เรียก API (PostgREST หรือ RPC) เพื่อรัน query ตาม blocks ใน database/03_test_rls_policies.sql
  3) ประมวลผลผลลัพธ์และเปรียบเทียบกับ expected outcomes
- ข้อดี: รันซ้ำได้ง่ายและสามารถรวมเข้ากับ CI ที่ช้ำนโยบาย staging

ไฟล์อ้างอิง
- Migration v2: database/01_payroll_migration_v2.sql
- Seed: database/02_seed_staging_data.sql
- Test queries: database/03_test_rls_policies.sql
- Provisioning guide: docs/staging-users-setup.md
- Execution guide: docs/staging-execution-guide.md

หากต้องการ ฉันสามารถช่วย:
- สร้างตัวอย่าง Node.js script สำหรับรัน automated RLS tests (ต้องการค่า endpoint, supabase url/keys ของ Staging)
- สร้างแบบฟอร์มรายงานผลการทดสอบ (CSV/Markdown) ที่ทีม QA กรอกผลลัพธ์ลง

— End of Checklist —
