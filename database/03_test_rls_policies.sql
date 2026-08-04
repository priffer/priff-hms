-- database/03_test_rls_policies.sql
-- ชุดคำสั่ง SQL สำหรับทดสอบ RLS / Permission Verification บน Staging
-- หมายเหตุสำคัญ:
-- 1) สคริปต์นี้เป็น "ชุดคำสั่งตรวจสอบ" (verification queries) ไม่ได้เปลี่ยนข้อมูล (ยกเว้นบางบล็อกเป็นตัวอย่าง UPDATE/INSERT ที่ต้องรันใน transaction ทดสอบเท่านั้น)
-- 2) ก่อนรัน: ต้อง provision ผู้ใช้ใน Supabase Auth (Staging) และบันทึกค่า auth.users.id ลงในตาราง public.user_profiles.auth_uid ตามคู่มือ docs/staging-users-setup.md
-- 3) วิธีการรันที่แนะนำ: ใช้ SQL Editor ใน Supabase (ที่ล็อกอินเป็น "Admin" เพื่อรันบล็อกตรวจสอบแบบเปรียบเทียบ) และ "รันแต่ละบล็อก" โดยสลับเป็นการรันผ่าน API/Client ที่ล็อกอินด้วยบัญชีทดสอบจริง (Employee / Supervisor / Payroll / Admin) เพื่อให้ auth.uid() ในเซสชันเป็นของบัญชีทดสอบนั้น
--    - วิธีปฏิบัติที่ปลอดภัย: สำหรับการทดสอบ RLS ให้ใช้ REST/PostgREST หรือแอป/console ที่ยืนยันตัวตนด้วยบัญชีทดสอบ (ไม่ควรรันทดสอบภายใต้ service_role หรือ superuser เพราะจะไม่ถูกจำกัดโดย RLS)
-- 4) ให้แก้ค่า PLACEHOLDER ตาม environment ของคุณก่อนรัน: <EMP_UID>, <EMP_PROFILE_ID>, <EMP_EMP_ID>, <SUPERVISOR_UID>, <SUPERVISOR_PROFILE_ID>, <SUPERVISOR_CLIENT_ID>, <PAYROLL_UID>, <ADMIN_UID>, <COMPANY_ID>

-- =========================
-- Helper: รายงานแยกเพื่อเปรียบเทียบ (ให้รันโดย Admin หลังจากทดสอบแต่ละบล็อก)
-- =========================
-- ตัวอย่าง: แสดงจำนวนแถวทั้งหมดในตารางที่เกี่ยวข้อง (สำหรับการอ้างอิง)
-- (รันโดย Admin / service_role เพื่อดู "ground truth")

/* Admin: ตรวจสอบขอบเขตข้อมูลโดยรวม (ground truth) */
-- SELECT COUNT(*) AS total_attendance_logs FROM public.attendance_logs WHERE company_id = '<COMPANY_ID>';
-- SELECT COUNT(*) AS total_payslips FROM public.payroll_payslips WHERE company_id = '<COMPANY_ID>';
-- SELECT COUNT(*) AS total_payroll_runs FROM public.payroll_runs WHERE company_id = '<COMPANY_ID>';

-- =========================
-- Test 1: Employee Role
-- วัตถุประสงค์:
--  - พนักงานควรเห็นเฉพาะ attendance_logs และ payroll_payslips ของตนเองเท่านั้น
--  - พนักงานต้องไม่สามารถแก้ไขข้อมูลของผู้อื่นได้
-- วิธีรัน:
--  1) ล็อกอินใน client (เช่น REST หรือ Supabase client) เป็นบัญชี employee (auth.users.id = <EMP_UID>)
--  2) รันบล็อก SQL ด้านล่างใน context ของ session ดังกล่าว
--  3) บันทึกผลลัพธ์ และเปรียบเทียบกับผลลัพธ์ที่ Admin ได้จาก "ground truth" queries ด้านบน
-- =========================

-- <EMPLOYEE SESSION> : Replace placeholders and run as Employee user session
-- 1. ดู attendance_logs ที่ผู้ใช้สามารถ SELECT ได้ (ต้องมีเฉพาะ emp_id ของตน)
SELECT id, emp_id, client_id, work_date, check_in, check_out, status
FROM public.attendance_logs
WHERE emp_id = '<EMP_EMP_ID>'
ORDER BY work_date DESC
LIMIT 50;

-- 2. ดู payslips ที่ผู้ใช้สามารถ SELECT ได้ (แสดงเฉพาะสลิปของตน)
SELECT p.id, p.payroll_run_id, p.employee_id, p.gross_amount, p.net_amount, p.created_at
FROM public.payroll_payslips p
WHERE p.employee_id = (SELECT id FROM public.employees WHERE emp_id = '<EMP_EMP_ID>' LIMIT 1)
ORDER BY p.created_at DESC
LIMIT 20;

-- 3. ลอง UPDATE แถวของพนักงานคนอื่น (ต้องคาดว่า rows_affected = 0 เมื่อ RLS ทำงาน)
BEGIN;
UPDATE public.attendance_logs
SET manual_override_reason = 'RLS Test - unauthorized update attempt'
WHERE emp_id <> '<EMP_EMP_ID>'
AND work_date = current_date
RETURNING id, emp_id;
ROLLBACK; -- undo; บล็อกนี้แสดงผลลัพธ์การอัพเดตที่เป็นไปได้

-- 4. ตรวจสอบว่าจำนวนแถว attendance_logs ที่ employee เห็นเทียบกับ ground truth (Admin) เป็นไปตามคาด
-- (รันโดย Admin เพื่อเปรียบเทียบ)
-- SELECT COUNT(*) AS employee_view_count FROM public.attendance_logs WHERE emp_id = '<EMP_EMP_ID>' AND company_id = '<COMPANY_ID>';

-- =========================
-- Test 2: Supervisor Role
-- วัตถุประสงค์:
--  - Supervisor ควร SELECT/UPDATE attendance_logs เฉพาะ client_id ที่ถูกมอบหมายใน supervisor_client_assignments
--  - Supervisor ห้ามเข้าถึง payroll_runs/pryoll_payslips (ตามนโยบาย)
-- วิธีรัน:
--  1) ล็อกอินเป็น Supervisor (auth.users.id = <SUPERVISOR_UID>)
--  2) รันบล็อก SQL ด้านล่างใน session ของ Supervisor
-- =========================

-- <SUPERVISOR SESSION>
-- รายการไซต์ที่ Supervisor ถูกมอบหมาย (ตรวจสอบ mapping)
SELECT sca.client_id, c.client_name
FROM public.supervisor_client_assignments sca
LEFT JOIN public.clients c ON c.id = sca.client_id
WHERE sca.user_profile_id = '<SUPERVISOR_PROFILE_ID>'
AND sca.company_id = '<COMPANY_ID>';

-- Supervisor ควรเห็น attendance_logs เฉพาะ client_id ด้านบน
SELECT id, emp_id, client_id, work_date, check_in, check_out, status
FROM public.attendance_logs
WHERE client_id IN (
  SELECT client_id FROM public.supervisor_client_assignments WHERE user_profile_id = '<SUPERVISOR_PROFILE_ID>' AND company_id = '<COMPANY_ID>'
)
ORDER BY work_date DESC
LIMIT 100;

-- Supervisor พยายามเข้าถึง payroll_runs (ควรถูกปฏิเสธหรือไม่มีแถว)
-- corrected: payroll_runs does not have period_start/period_end. Join to payroll_periods to show period_start/period_end
SELECT pr.id, pr.company_id, pp.period_start, pp.period_end, pr.status
FROM public.payroll_runs pr
LEFT JOIN public.payroll_periods pp ON pr.period_id = pp.id
LIMIT 50;

-- ลอง UPDATE attendance_logs ใน client ที่ไม่ได้รับมอบหมาย (ควรได้ rows_affected = 0)
BEGIN;
UPDATE public.attendance_logs
SET manual_override_reason = 'Supervisor RLS negative test'
WHERE client_id NOT IN (
  SELECT client_id FROM public.supervisor_client_assignments WHERE user_profile_id = '<SUPERVISOR_PROFILE_ID>' AND company_id = '<COMPANY_ID>'
)
AND work_date >= current_date - INTERVAL '7 days'
RETURNING id, client_id;
ROLLBACK;

-- =========================
-- Test 3: Payroll Role
-- วัตถุประสงค์:
--  - Payroll role สามารถ SELECT/INSERT/UPDATE ตาราง payroll_* ได้
--  - Payroll role ไม่ควรเห็น attendance_logs ของบริษัทอื่น (company_id isolation)
-- วิธีรัน:
--  1) ล็อกอินเป็น Payroll user (auth.users.id = <PAYROLL_UID>)
--  2) รันบล็อก SQL ด้านล่าง
-- =========================

-- Payroll: SELECT payroll_periods / payroll_runs / payroll_lines
SELECT id, company_id, period_start, period_end, status FROM public.payroll_periods WHERE company_id = '<COMPANY_ID>' ORDER BY period_start DESC LIMIT 20;

SELECT id, company_id, period_id, status, created_at FROM public.payroll_runs WHERE company_id = '<COMPANY_ID>' ORDER BY created_at DESC LIMIT 20;

SELECT id, payroll_run_id, emp_id, gross_pay, net_pay
FROM public.payroll_lines
WHERE payroll_run_id IN (
  SELECT id FROM public.payroll_runs WHERE company_id = '<COMPANY_ID>'
)
LIMIT 50;

-- Payroll: ตัวอย่าง INSERT ใน transaction (ทดลองสร้าง payroll_line แล้ว rollback)
BEGIN;
INSERT INTO public.payroll_lines (id, payroll_run_id, emp_id, employee_id, gross_pay, net_pay, company_id, created_at)
VALUES (
  gen_random_uuid(),
  (SELECT id FROM public.payroll_runs WHERE company_id = '<COMPANY_ID>' LIMIT 1),
  '<EMP_EMP_ID>',
  (SELECT id FROM public.employees WHERE emp_id = '<EMP_EMP_ID>' LIMIT 1),
  1000, 900, '<COMPANY_ID>', timezone('utc', now())
)
RETURNING id, payroll_run_id;
ROLLBACK;

-- Payroll: พยายาม SELECT attendance_logs ของบริษัทอื่น (ควรไม่มีผลลัพธ์)
SELECT id, emp_id, client_id, work_date FROM public.attendance_logs WHERE company_id <> '<COMPANY_ID>' LIMIT 50;

-- =========================
-- Test 4: Admin Role
-- วัตถุประสงค์:
--  - Admin สามารถเข้าถึงข้อมูลภายใน company_id เดียวกันได้ครบถ้วน
-- วิธีรัน:
--  1) ล็อกอินเป็น Admin (auth.users.id = <ADMIN_UID>) หรือใช้ service_role/DBA privilege เพื่อรัน queries เปรียบเทียบ
-- =========================

-- Admin: ดู attendance_logs ทั้งหมดใน company
SELECT id, emp_id, client_id, work_date, check_in, check_out, status
FROM public.attendance_logs
WHERE company_id = '<COMPANY_ID>'
ORDER BY work_date DESC LIMIT 200;

-- Admin: ดู payroll_runs และ payroll_lines ทั้งหมดใน company
SELECT id, company_id, period_id, status, created_at FROM public.payroll_runs WHERE company_id = '<COMPANY_ID>' ORDER BY created_at DESC LIMIT 50;
SELECT id, payroll_run_id, emp_id, gross_pay, net_pay FROM public.payroll_lines WHERE company_id = '<COMPANY_ID>' ORDER BY id DESC LIMIT 200;

-- =========================
-- End of tests
-- คำแนะนำการรายงานผล:
-- - ให้บันทึกผลลัพธ์ของแต่ละบล็อก (rows returned / rows affected) และแนบกับรายงานการทดสอบ
-- - หากผลลัพธ์ไม่เป็นไปตามคาด ให้แนบผลลัพธ์ของ Admin (ground truth) เพื่อให้ทีม DBA สามารถตรวจสอบ policy / helper function ได้รวดเร็ว
-- - หลีกเลี่ยงการรันบล็อกที่เป็น INSERT/UPDATE/DELETE บน production; หากต้องทดสอบการเขียน ให้รันใน transaction และ rollback เสมอ (ตัวอย่างด้านบนใช้ BEGIN...ROLLBACK)

-- หมายเหตุสุดท้าย:
-- หากต้องการ automation ของชุดทดสอบนี้ แนะนำเขียนสคริปต์ Node/Python ที่:
--  1) signIn ด้วยบัญชีทดสอบ (รับ JWT)
--  2) เรียก endpoint /rpc หรือ PostgREST ด้วย Authorization: Bearer <JWT> เพื่อรันคำสั่ง (ผ่าน REST) และประมวลผลผลลัพธ์
--  3) เปรียบเทียบผลกับ expected outcomes ที่กำหนดไว้

-- End of file
