-- =====================================================
-- database/11_advance_payment_eligibility.sql
-- ขอเบิกเงินล่วงหน้า: จำกัดสิทธิ์เฉพาะพนักงานฝ่ายปฏิบัติการที่ผูกไซต์ลูกค้าแล้วเท่านั้น
--
-- บริบท (ตัดสินใจร่วมกับ user ผ่าน ask_user ใน session นี้):
--   - Q: เบิกได้ไม่จำกัดยอด/ไม่จำกัดใครตอนนี้ ควรจำกัดสิทธิ์ไหม?
--   - A: จำกัดเฉพาะพนักงาน "ปฏิบัติการ" ที่ผูกไซต์ลูกค้าแล้ว (user_profiles.primary_client_id
--     ไม่ว่าง) ส่วนพนักงานออฟฟิศรายเดือน (ไม่ผูกไซต์) ห้ามเบิก
--   - เรื่องคำนวณเพดานยอดเบิกตามวันทำงาน/OT สะสม และแสดงยอดสะสมให้พนักงานเห็น: เลื่อนไปทำ
--     ตอนสร้าง Payroll Engine จริง (Milestone 4) เพราะต้องพึ่งตัวเลขค่าจ้าง/OT ที่คำนวณแม่นยำ
--     ตามกฎหมายแรงงาน - ไม่ทำแบบประมาณการคู่ขนานตอนนี้เพราะเสี่ยงเลขไม่ตรงกับสลิปจริง
--
-- ระหว่างแก้ พบ gap เพิ่มเติมที่เกี่ยวข้องโดยตรง: policy INSERT เดิม (07_advance_payments_rls.sql)
-- อนุญาตแค่ role 'employee'/'admin' เท่านั้น - role 'supervisor' ที่เห็นปุ่มนี้ในหน้า ESS เดียวกัน
-- (employee-dashboard.html อนุญาตทั้ง employee/supervisor) จะกดส่งคำขอไม่ได้เลยเพราะโดน RLS
-- ปฏิเสธเงียบๆ มาตั้งแต่ต้น จึงแก้ไปพร้อมกันในไฟล์นี้ โดยให้ supervisor นับว่า "ปฏิบัติการ"
-- ได้ถ้าดูแลไซต์ลูกค้าอย่างน้อย 1 ไซต์ผ่าน supervisor_client_assignments (เทียบเท่า primary_client_id
-- ของ role employee)
--
-- Idempotent: DROP POLICY / DROP FUNCTION IF EXISTS ก่อนสร้างใหม่เสมอ
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

BEGIN;

-- Helper: ผู้ใช้ที่ login อยู่ "ผูกไซต์ลูกค้า" แล้วหรือไม่ (ใช้ร่วมกันได้ทั้ง employee/supervisor)
-- SECURITY DEFINER เช่นเดียวกับ get_user_role()/get_user_company() ที่มีอยู่แล้ว
DROP FUNCTION IF EXISTS public.is_site_assigned_employee();
CREATE OR REPLACE FUNCTION public.is_site_assigned_employee()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.auth_uid = auth.uid()
    AND (
      up.primary_client_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM public.supervisor_client_assignments sca
        WHERE sca.user_profile_id = up.id
      )
    )
  );
$$;

-- INSERT: employee/supervisor ขอเบิกของตัวเองได้เฉพาะเมื่อผูกไซต์ลูกค้าแล้วเท่านั้น
DROP POLICY IF EXISTS advance_payments_insert_employee ON public.advance_payments;
CREATE POLICY advance_payments_insert_employee ON public.advance_payments
  FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company()
    AND (
      public.get_user_role() = 'admin'
      OR (
        public.get_user_role() IN ('employee', 'supervisor')
        AND emp_id = (SELECT emp_id FROM public.user_profiles WHERE auth_uid = auth.uid())
        AND status = 'pending'
        AND public.is_site_assigned_employee()
      )
    )
  );

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'advance_payments' AND policyname = 'advance_payments_insert_employee';
-- SELECT proname FROM pg_proc WHERE proname = 'is_site_assigned_employee';
