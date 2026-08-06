-- =====================================================
-- database/13_leave_requests_rls_recursion_fix.sql
-- แก้บั๊ก RLS recursion บน leave_requests INSERT policy (พบจากการทดสอบจริง)
--
-- อาการ: "infinite recursion detected in policy for relation leave_requests" (Postgres 42P17)
-- สาเหตุ: policy leave_requests_insert_employee (จาก 12_leave_policy_enhancements.sql) เช็คเงื่อนไข
-- max_occurrences_lifetime ด้วย subquery ที่ query ตาราง leave_requests เอง (COUNT(*) FROM
-- public.leave_requests lr2 ...) - Postgres ต้องประเมิน SELECT policy ของ leave_requests เพื่อกรอง
-- แถวใน subquery นั้น แต่ตัว SELECT policy เองก็อยู่ระหว่างถูกประเมินจาก INSERT policy ที่ครอบมันอยู่
-- อีกที ทำให้เกิดวงวนไม่รู้จบ
--
-- แก้โดยย้าย logic การนับไปไว้ใน SECURITY DEFINER function แบบเดียวกับ get_user_role()/
-- get_user_company() ที่มีอยู่แล้ว (01_payroll_migration_v2.sql PART 3) - ฟังก์ชันเหล่านี้ query
-- ตารางที่มี RLS ได้โดยไม่วนซ้ำ เพราะรันด้วยสิทธิ์เจ้าของฟังก์ชันซึ่ง bypass RLS ได้ตามปกติ (ระบบนี้
-- ไม่ได้เปิด FORCE ROW LEVEL SECURITY ไว้ ตามที่ระบุไว้แล้วใน 05_rls_remediation.sql)
--
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS ก่อนสร้างใหม่เสมอ
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.count_lifetime_leave_requests(p_employee_id uuid, p_leave_type_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer FROM public.leave_requests
  WHERE employee_id = p_employee_id
  AND leave_type_id = p_leave_type_id
  AND status IN ('pending', 'approved');
$$;

DROP POLICY IF EXISTS leave_requests_insert_employee ON public.leave_requests;
CREATE POLICY leave_requests_insert_employee ON public.leave_requests
  FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company()
    AND (
      public.get_user_role() = 'admin'
      OR (
        public.get_user_role() = 'employee'
        AND emp_id = (SELECT emp_id FROM public.user_profiles WHERE auth_uid = auth.uid())
        AND employee_id = (SELECT employee_id FROM public.user_profiles WHERE auth_uid = auth.uid())
        AND status = 'pending'
        AND (
          NOT EXISTS (
            SELECT 1 FROM public.leave_types lt WHERE lt.id = leave_type_id AND lt.min_tenure_days IS NOT NULL
          )
          OR EXISTS (
            SELECT 1 FROM public.leave_types lt
            JOIN public.employees e ON e.id = leave_requests.employee_id
            WHERE lt.id = leave_requests.leave_type_id
            AND e.available_start_date IS NOT NULL
            AND (CURRENT_DATE - e.available_start_date) >= lt.min_tenure_days
          )
        )
        AND (
          NOT EXISTS (
            SELECT 1 FROM public.leave_types lt WHERE lt.id = leave_type_id AND lt.max_occurrences_lifetime IS NOT NULL
          )
          OR public.count_lifetime_leave_requests(leave_requests.employee_id, leave_requests.leave_type_id)
             < (SELECT lt.max_occurrences_lifetime FROM public.leave_types lt WHERE lt.id = leave_requests.leave_type_id)
        )
      )
    )
  );

COMMIT;

-- =====================================================
-- Verification query (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT proname FROM pg_proc WHERE proname = 'count_lifetime_leave_requests';
