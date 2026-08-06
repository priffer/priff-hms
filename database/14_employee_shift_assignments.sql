-- =====================================================
-- database/14_employee_shift_assignments.sql
-- ESS Redesign (รอบ 5): ตารางกะการทำงานต่อพนักงาน — ฐานรากที่ต้องมีก่อนจะทำ
-- ฟีเจอร์ตรวจจับมาสาย/ครึ่งวัน/ทำงานเกินเวลา (โอที) และคำขอแก้ไขเวลาเข้า-ออกงาน
--
-- บริบท: ผู้ใช้ชี้ประเด็นสำคัญว่าพนักงานแต่ละคน/แต่ละหน้างานไม่ได้ทำงานเวลาตายตัวเหมือนกันหมด
-- (บางหน้างาน 7:00-16:00, บางหน้างาน 8:00-17:00, และมีงานกะกลางวัน/กลางคืน) ในขณะที่
-- attendance_logs ปัจจุบันเก็บแค่ check_in/check_out จริง ไม่มีแนวคิด "เวลาตามกะที่ควรจะเป็น"
-- เลย ทำให้คำนวณ "สาย/ออกก่อน/ทำงานเกินกะ" ไม่ได้เลยในตอนนี้ - เป็น prerequisite ก่อนทำ
-- ฟีเจอร์ขอโอที (ต้องรู้ว่า "เกินกะ" คือเกินจากอะไร)
--
-- ออกแบบผูกกะกับ "พนักงานรายคน" ไม่ใช่ผูกกับไซต์ลูกค้า เพราะคนในไซต์เดียวกันอาจสลับกะ
-- กลางวัน/กลางคืนได้ (ตามที่ผู้ใช้ระบุ) - มี effective_from/effective_to รองรับการเปลี่ยนกะ
-- ในอนาคตโดยไม่ทับประวัติเก่า รองรับกะข้ามเที่ยงคืน (shift_end < shift_start = กะกลางคืน)
-- คำนวณ is_night_shift สดจากข้อมูล ไม่เก็บซ้ำเพื่อกันข้อมูลไม่ตรงกัน
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS ก่อนสร้างใหม่เสมอ
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'comp_kc_clean',
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  shift_name text, -- ป้ายชื่อกะ (ถ้ามี) เช่น "กะเช้า", "กะดึก" - เพื่อการแสดงผลเท่านั้น ไม่ใช้คำนวณ
  shift_start time NOT NULL,
  shift_end time NOT NULL, -- ถ้า shift_end < shift_start แปลว่ากะข้ามเที่ยงคืน (กะกลางคืน)
  standard_hours numeric NOT NULL, -- ชั่วโมงทำงานปกติ/วันของกะนี้ เช่น 8, 9 (ใช้คำนวณ OT/ลาบางส่วนในอนาคต)
  effective_from date NOT NULL,
  effective_to date, -- null = ยังมีผลอยู่ปัจจุบัน
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT employee_shift_assignments_time_check CHECK (standard_hours > 0 AND standard_hours <= 24)
);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_employee ON public.employee_shift_assignments (employee_id);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_company ON public.employee_shift_assignments (company_id);
-- กันไม่ให้พนักงานคนเดียวกันมีกะ "กำลังใช้งานอยู่" (effective_to IS NULL) ซ้อนกันมากกว่า 1 แถว
CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_assignments_one_active_per_employee
  ON public.employee_shift_assignments (employee_id) WHERE effective_to IS NULL;

COMMIT;

-- =====================================================
-- PART 2: RLS
-- ผูกทัศนวิสัยของหัวหน้างานกับไซต์ที่ดูแล (supervisor_client_assignments ผ่าน
-- user_profiles.primary_client_id ของพนักงานคนนั้น) ให้สอดคล้องกับ pattern เดียวกับ
-- advance_payments/leave_requests approver-scope ที่ใช้ไซต์เป็นเกณฑ์ - ไม่ใช้ department
-- (employees table เดิมใช้ department เป็นเกณฑ์ทัศนวิสัยของ supervisor ซึ่งเป็นความไม่
-- สอดคล้องที่มีอยู่ก่อนแล้วในระบบ ไม่ได้แก้ในไฟล์นี้ เพราะนอกขอบเขตงานรอบนี้)
-- =====================================================

BEGIN;

ALTER TABLE public.employee_shift_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shift_assignments_select ON public.employee_shift_assignments;
CREATE POLICY shift_assignments_select ON public.employee_shift_assignments
  FOR SELECT
  USING (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
    OR (
      public.get_user_role() = 'employee'
      AND employee_id = (SELECT employee_id FROM public.user_profiles WHERE auth_uid = auth.uid())
    )
    OR (
      public.get_user_role() = 'supervisor' AND company_id = public.get_user_company()
      AND EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.employee_id = employee_shift_assignments.employee_id
        AND up.primary_client_id IN (
          SELECT client_id FROM public.supervisor_client_assignments WHERE user_profile_id = public.get_user_profile_id()
        )
      )
    )
  );

DROP POLICY IF EXISTS shift_assignments_manage_admin_payroll ON public.employee_shift_assignments;
CREATE POLICY shift_assignments_manage_admin_payroll ON public.employee_shift_assignments
  FOR ALL
  USING (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company())
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company());

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'employee_shift_assignments';
