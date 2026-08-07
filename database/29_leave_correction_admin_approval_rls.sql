-- =====================================================
-- database/29_leave_correction_admin_approval_rls.sql
-- Admin/ESS UI gap ที่พบระหว่าง Payroll Engine session (user ยืนยันให้สร้างหน้าอนุมัติ):
-- ระบบไม่เคยมีหน้า admin/หัวหน้างานสำหรับอนุมัติ "คำขอลา" เลย และไม่มีหน้า admin สำหรับ
-- ตรวจสอบ "คำขอแก้ไขเวลา" กรณี fallback (พนักงานไม่มีหัวหน้างานประจำไซต์)
--
-- ไฟล์นี้แก้เฉพาะ RLS ของ leave_requests: เพิ่ม role 'payroll' ให้อนุมัติ/ปฏิเสธได้เหมือน role
-- 'admin' (เดิมมีแต่ admin/supervisor เท่านั้นที่ UPDATE ได้ - ไม่สอดคล้องกับ pattern ที่ใช้ทั่วทั้ง
-- ระบบที่ปฏิบัติต่อ admin กับ payroll เท่ากันเสมอ เช่น ot_requests, attendance_correction_requests,
-- payroll_* ทุกตาราง) - เป็นการแก้ไข RLS ให้สอดคล้องกัน ไม่กระทบตัวเลขคำนวณ/กฎหมายแรงงานใดๆ
--
-- attendance_correction_requests ไม่ต้องแก้ RLS เพิ่ม (มี payroll อยู่แล้วในนโยบายเดิม)
--
-- Idempotent: DROP POLICY IF EXISTS ก่อน CREATE เสมอ
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

BEGIN;

DROP POLICY IF EXISTS leave_requests_update_self_cancel ON public.leave_requests;
CREATE POLICY leave_requests_update_self_cancel ON public.leave_requests
  FOR UPDATE
  USING (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
    OR (
      public.get_user_role() = 'employee'
      AND emp_id = (SELECT emp_id FROM public.user_profiles WHERE auth_uid = auth.uid())
      AND status = 'pending'
    )
    OR (
      public.get_user_role() = 'supervisor' AND company_id = public.get_user_company()
      AND employee_id IN (
        SELECT e.id FROM public.employees e
        WHERE e.department_id = (SELECT department_id FROM public.user_profiles WHERE auth_uid = auth.uid())
      )
    )
  )
  WITH CHECK (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
    OR (
      public.get_user_role() = 'employee'
      AND emp_id = (SELECT emp_id FROM public.user_profiles WHERE auth_uid = auth.uid())
      AND status IN ('pending', 'cancelled')
    )
    OR (
      public.get_user_role() = 'supervisor' AND company_id = public.get_user_company()
      AND employee_id IN (
        SELECT e.id FROM public.employees e
        WHERE e.department_id = (SELECT department_id FROM public.user_profiles WHERE auth_uid = auth.uid())
      )
    )
  );

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.leave_requests'::regclass;
