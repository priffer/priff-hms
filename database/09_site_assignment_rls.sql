-- =====================================================
-- database/09_site_assignment_rls.sql
-- ESS Redesign (รอบ 2): เปิดให้ role 'payroll' จัดการ user_profiles /
-- supervisor_client_assignments ได้เหมือน 'admin' (ไม่ใช่แค่ SELECT อย่างเดียว)
--
-- บริบท: เพิ่มฟีเจอร์ "ผูกไซต์ลูกค้าประจำให้พนักงาน" ในหน้า admin-employees.html
-- ซึ่งอนุญาตให้ทั้ง admin และ payroll เข้าหน้านี้ได้อยู่แล้ว (ดู requireAuth(['admin','payroll'])
-- ใน admin-employees.html) แต่ policy เดิมจาก 05_rls_remediation.sql (user_profiles_manage_admin,
-- supervisor_assignments_manage_admin) อนุญาตเฉพาะ role admin เท่านั้นให้ UPDATE/INSERT/DELETE
-- ทำให้ payroll กด "บันทึกไซต์งาน" แล้วจะโดน RLS เงียบๆ (0 rows affected)
--
-- เพื่อความสอดคล้องกับ pattern ที่ใช้ทั่วทั้งระบบนี้ (announcements/company_holidays/
-- client_holidays/leave_types ล้วนให้ admin+payroll จัดการเท่ากันหมด) จึงขยาย policy นี้
-- ให้ payroll จัดการได้เท่ากับ admin เช่นกัน ไม่ได้เพิ่มสิทธิ์ใหม่เกินขอบเขตเดิมของระบบ
--
-- Idempotent: DROP POLICY IF EXISTS ก่อนสร้างใหม่เสมอ
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

BEGIN;

-- 1) user_profiles: admin + payroll จัดการได้ (เดิมมีแค่ admin)
DROP POLICY IF EXISTS user_profiles_manage_admin ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_manage_admin_payroll ON public.user_profiles;
CREATE POLICY user_profiles_manage_admin_payroll ON public.user_profiles
  FOR ALL
  USING (
    public.get_user_role() IN ('admin', 'payroll')
    AND company_id = public.get_user_company()
  )
  WITH CHECK (
    public.get_user_role() IN ('admin', 'payroll')
    AND company_id = public.get_user_company()
  );

-- 2) supervisor_client_assignments: admin + payroll จัดการได้ (เดิมมีแค่ admin)
DROP POLICY IF EXISTS supervisor_assignments_manage_admin ON public.supervisor_client_assignments;
DROP POLICY IF EXISTS supervisor_assignments_manage_admin_payroll ON public.supervisor_client_assignments;
CREATE POLICY supervisor_assignments_manage_admin_payroll ON public.supervisor_client_assignments
  FOR ALL
  USING (
    public.get_user_role() IN ('admin', 'payroll')
    AND company_id = public.get_user_company()
  )
  WITH CHECK (
    public.get_user_role() IN ('admin', 'payroll')
    AND company_id = public.get_user_company()
  );

COMMIT;

-- =====================================================
-- Verification query (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE tablename IN ('user_profiles','supervisor_client_assignments');
