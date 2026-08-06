-- =====================================================
-- database/07_advance_payments_rls.sql
-- ESS Redesign: Fix broken RLS on advance_payments
--
-- บริบท (ยืนยันได้จากการอ่าน migration scripts ทั้งหมดในโฟลเดอร์นี้):
--   - ไม่มี "ALTER TABLE public.advance_payments ENABLE ROW LEVEL SECURITY"
--     ปรากฏอยู่ใน 01_payroll_migration.sql, 01_payroll_migration_v2.sql หรือ
--     05_rls_remediation.sql เลยแม้แต่ครั้งเดียว ในขณะที่ employees, attendance_logs,
--     payroll_*, user_profiles ถูกเปิด RLS ครบแล้วในไฟล์เหล่านั้น
--   - ต้องตรวจสอบยืนยันสถานะจริงบน Staging ผ่าน
--     SELECT relrowsecurity FROM pg_class WHERE relname = 'advance_payments';
--     ก่อน apply ไฟล์นี้ (ดู verification query ท้ายไฟล์)
--   - ถ้า RLS ยังไม่ถูกเปิดเลย: ตารางนี้จะเป็น public อ่าน/เขียนได้ทุกคนที่ผ่าน
--     PostgREST มาได้ (โดยเฉพาะถ้า frontend ใช้ anon/publishable key)
--   - ถ้า RLS เปิดอยู่แล้วแต่ไม่มี policy เลย: ผลจะกลายเป็น default-deny ทุก role
--     รวมถึง admin ด้วย ทำให้ฟีเจอร์เบิกเงินล่วงหน้าที่มีอยู่แล้วฝั่ง Admin
--     (js/pages/employees/modal.js) ใช้งานไม่ได้จริง
--   ไม่ว่ากรณีใด ไฟล์นี้แก้ปัญหาได้ทั้งคู่ เพราะมีทั้ง ENABLE RLS และสร้าง policy ครบ
--
-- ไฟล์นี้เพิ่ม policy ตามที่ออกแบบไว้ใน docs/rls-architecture-design.md section 2.3.5
-- (ไม่ใช่การออกแบบใหม่ เป็นการ implement สเปกที่มีอยู่แล้วแต่ไม่เคยถูกสร้างจริง)
--   - employee: SELECT/INSERT เฉพาะของตนเอง, ไม่มี UPDATE/DELETE (คงพฤติกรรมเดิมที่
--     admin เป็นผู้ approve/reject/อัปโหลดสลิปโอนเงินเท่านั้น ตาม modal.js ปัจจุบัน)
--   - supervisor: SELECT เฉพาะพนักงานแผนกเดียวกัน (อ่านอย่างเดียว ไม่มีสิทธิ์อนุมัติ)
--   - payroll: SELECT + UPDATE เฉพาะช่วงที่ payroll engine หักเงินจริง
--     (deducted_in_payroll_run_id, deducted_amount) -- RLS จำกัดได้แค่ระดับแถว
--     การจำกัดคอลัมน์ต้องบังคับที่ application layer เพิ่มเติม (แนวเดียวกับ
--     attendance_update_supervisor ที่มีอยู่แล้วในระบบ ซึ่งก็ไม่ได้ enforce คอลัมน์เช่นกัน)
--   - admin: CRUD เต็มในขอบเขต company_id
--
-- สคริปต์นี้ Idempotent (DROP POLICY IF EXISTS ก่อน CREATE ทุกครั้ง, ALTER TABLE ...
-- ADD COLUMN IF NOT EXISTS สำหรับคอลัมน์ใหม่หนึ่งคอลัมน์)
-- คอลัมน์อื่นที่ใช้ (company_id, deducted_in_payroll_run_id, deducted_amount,
-- approved_at, approved_by) มีอยู่แล้วจาก 01_payroll_migration_v2.sql PART 1.2
-- รันบน Staging เท่านั้นก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

BEGIN;

-- เพิ่มคอลัมน์ employee_remark: แยกหมายเหตุที่พนักงานกรอกตอนขอเบิกออกจาก
-- admin_remarks (ซึ่งมีไว้สำหรับแอดมินบันทึกเหตุผลตอนอนุมัติ/ปฏิเสธ)
-- ตรงกับ "remarks" ใน docs/payroll-database-design.md ข้อ 3.11 (advance_payments ปรับปรุง)
-- เป็น additive column เดียว ไม่กระทบข้อมูลเดิม
ALTER TABLE public.advance_payments
  ADD COLUMN IF NOT EXISTS employee_remark text;

-- SELECT
DROP POLICY IF EXISTS advance_payments_select ON public.advance_payments;
CREATE POLICY advance_payments_select ON public.advance_payments
  FOR SELECT
  USING (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
    OR (public.get_user_role() = 'employee' AND emp_id = (SELECT emp_id FROM public.user_profiles WHERE auth_uid = auth.uid()))
    OR (
      public.get_user_role() = 'supervisor' AND company_id = public.get_user_company()
      AND emp_id IN (
        SELECT e.emp_id FROM public.employees e
        WHERE e.department_id = (SELECT department_id FROM public.user_profiles WHERE auth_uid = auth.uid())
      )
    )
  );

-- INSERT: employee ขอเบิกของตัวเองเท่านั้น; บังคับ company_id/emp_id ให้ตรงกับ session และ status เริ่มต้นต้องเป็น pending
DROP POLICY IF EXISTS advance_payments_insert_employee ON public.advance_payments;
CREATE POLICY advance_payments_insert_employee ON public.advance_payments
  FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company()
    AND (
      (public.get_user_role() = 'employee'
        AND emp_id = (SELECT emp_id FROM public.user_profiles WHERE auth_uid = auth.uid())
        AND status = 'pending')
      OR public.get_user_role() = 'admin'
    )
  );

-- UPDATE: admin/payroll เท่านั้น (approve/reject/อัปโหลดสลิป/หัก payroll)
-- ไม่เปิดให้ employee UPDATE เอง เพื่อคงพฤติกรรมเดิมของระบบ admin ที่มีอยู่แล้ว
DROP POLICY IF EXISTS advance_payments_update_admin_payroll ON public.advance_payments;
CREATE POLICY advance_payments_update_admin_payroll ON public.advance_payments
  FOR UPDATE
  USING (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company())
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company());

-- DELETE: admin เท่านั้น
DROP POLICY IF EXISTS advance_payments_delete_admin ON public.advance_payments;
CREATE POLICY advance_payments_delete_admin ON public.advance_payments
  FOR DELETE
  USING (public.get_user_role() = 'admin' AND company_id = public.get_user_company());

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate เพื่อ sanity check)
-- =====================================================
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'advance_payments';
