-- =====================================================
-- database/15_attendance_correction_requests.sql
-- ESS Redesign (รอบ 5 ต่อเนื่อง): ฟีเจอร์ "ขอแก้ไขเวลาเข้า-ออกงาน" + โครงสร้างอนุมัติกลาง
-- ที่ใช้ร่วมกันได้กับฟีเจอร์ขอโอทีในรอบถัดไป (ไม่ต้องสร้างซ้ำ)
--
-- บริบท: ผู้ใช้ถามว่ากรณีลืมสแกนเวลา (เข้างานแต่ลืมออก, หรือลืมทั้งวัน) จะมี logic
-- ยังไง - คำตอบคือฟีเจอร์นี้: พนักงานยื่นคำขอแก้ไข/เพิ่มเวลาเข้า-ออกงาน แนบหลักฐานได้
-- (รูปภาพ/เอกสารอะไรก็ได้) แล้วให้หัวหน้างานหรือแอดมินอนุมัติก่อนถึงจะมีผลจริงกับ
-- attendance_logs (ป้องกันพนักงานแก้เวลาเองโดยไม่มีใครตรวจสอบ)
--
-- Approver resolution (ใช้ฟังก์ชันเดียวกันได้กับฟีเจอร์ขอโอทีในอนาคต):
--   1) หาหัวหน้างานที่ดูแลไซต์ลูกค้าที่พนักงานคนนี้ประจำอยู่ (supervisor_client_assignments
--      ผ่าน user_profiles.primary_client_id) - ถ้าเจอ ให้เป็นผู้อนุมัติชั้นแรก
--   2) ถ้าไม่เจอ (พนักงานออฟฟิศไม่ได้ผูกไซต์ หรือไซต์นั้นไม่มีหัวหน้างานดูแล) fallback ไปที่
--      admin/payroll โดยตรง
-- หมายเหตุ: เดิมตั้งใจจะมี fallback ชั้นกลางเป็น "หัวหน้าแผนก" ตามที่คุยไว้ในแชท แต่ตรวจสอบ
-- schema แล้วพบว่า departments ไม่มี field ผู้รับผิดชอบ/หัวหน้าแผนกอยู่เลย (ไม่มีข้อมูลจริงให้ใช้)
-- จึงตัดชั้นกลางนี้ออกไปก่อน เหลือ 2 ชั้น (ไซต์ -> admin/payroll) ถ้าต้องการเพิ่มภายหลัง
-- ต้องเพิ่ม department_head_id ใน departments ก่อน แล้วค่อยขยายฟังก์ชันนี้
--
-- ผลการอนุมัติ: อัปเดต/สร้างแถวใน attendance_logs ให้ตรงกับที่ขอ (มี trigger fn_attendance_audit
-- ที่มีอยู่แล้วบันทึก audit log การเปลี่ยนแปลงให้อัตโนมัติ ไม่ต้องเขียนเพิ่ม)
--
-- Idempotent: CREATE TABLE/FUNCTION IF NOT EXISTS หรือ OR REPLACE, DROP POLICY IF EXISTS ก่อนสร้างใหม่
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: Approver resolution function (SECURITY DEFINER เพื่อกัน RLS recursion
-- แบบเดียวกับที่เจอบั๊กจริงใน leave_requests - เขียนแบบ query ตารางที่มี RLS ได้อย่างปลอดภัย)
-- =====================================================

CREATE OR REPLACE FUNCTION public.resolve_approver_for_employee(p_employee_id uuid)
RETURNS TABLE(approver_role text, approver_user_profile_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid;
  v_supervisor_profile_id uuid;
BEGIN
  SELECT up.primary_client_id INTO v_client_id
  FROM public.employees e
  LEFT JOIN public.user_profiles up ON up.employee_id = e.id
  WHERE e.id = p_employee_id
  LIMIT 1;

  IF v_client_id IS NOT NULL THEN
    SELECT sca.user_profile_id INTO v_supervisor_profile_id
    FROM public.supervisor_client_assignments sca
    WHERE sca.client_id = v_client_id
    LIMIT 1;

    IF v_supervisor_profile_id IS NOT NULL THEN
      RETURN QUERY SELECT 'supervisor'::text, v_supervisor_profile_id;
      RETURN;
    END IF;
  END IF;

  -- ไม่มีไซต์ประจำ หรือไซต์นั้นไม่มีหัวหน้างานดูแล -> fallback ไปแอดมิน/payroll โดยตรง
  RETURN QUERY SELECT 'admin'::text, NULL::uuid;
END;
$$;

COMMIT;

-- =====================================================
-- PART 2: TABLE
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.attendance_correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'comp_kc_clean',
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  emp_id text NOT NULL,
  attendance_log_id uuid REFERENCES public.attendance_logs(id), -- null = ไม่มีแถวเดิมเลย (ลืมสแกนทั้งวัน)
  work_date date NOT NULL,
  requested_check_in time,
  requested_check_out time,
  requested_client_id uuid REFERENCES public.clients(id), -- เผื่อกรณีลงผิดไซต์ด้วยพร้อมกัน
  reason text NOT NULL,
  attachment_url text,
  status text NOT NULL DEFAULT 'pending', -- pending, approved, rejected
  resolved_approver_role text NOT NULL, -- 'supervisor' | 'admin' - snapshot ตอนสร้างคำขอ (ดู PART 1)
  resolved_approver_user_profile_id uuid, -- snapshot user_profile_id ของหัวหน้างานที่ถูกกำหนด (ถ้ามี)
  approved_by uuid,
  approved_at timestamp with time zone,
  rejection_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS idx_correction_requests_employee ON public.attendance_correction_requests (employee_id);
CREATE INDEX IF NOT EXISTS idx_correction_requests_company_status ON public.attendance_correction_requests (company_id, status);
CREATE INDEX IF NOT EXISTS idx_correction_requests_approver ON public.attendance_correction_requests (resolved_approver_user_profile_id);

COMMIT;

-- =====================================================
-- PART 3: RLS
-- =====================================================

BEGIN;

ALTER TABLE public.attendance_correction_requests ENABLE ROW LEVEL SECURITY;

-- SELECT: เจ้าของคำขอเห็นของตัวเอง, ผู้อนุมัติที่ถูกกำหนด (resolved_approver_user_profile_id ตรงกับตน)
-- เห็นคำขอที่ต้องอนุมัติ, admin/payroll เห็นทั้งหมดในบริษัท (ครอบคลุมกรณี fallback ที่ profile_id เป็น null)
DROP POLICY IF EXISTS correction_requests_select ON public.attendance_correction_requests;
CREATE POLICY correction_requests_select ON public.attendance_correction_requests
  FOR SELECT
  USING (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
    OR (
      public.get_user_role() IN ('employee', 'supervisor')
      AND emp_id = (SELECT emp_id FROM public.user_profiles WHERE auth_uid = auth.uid())
    )
    OR (
      public.get_user_role() = 'supervisor'
      AND resolved_approver_user_profile_id = public.get_user_profile_id()
    )
  );

-- INSERT: employee/supervisor สร้างคำขอของตัวเองเท่านั้น บังคับ emp_id/employee_id/company_id
-- ให้ตรงกับ session และ resolved_approver_* ต้องตรงกับผลลัพธ์จริงของ resolve_approver_for_employee()
-- (กันไม่ให้ client ปลอมแปลงว่าใครควรอนุมัติ)
DROP POLICY IF EXISTS correction_requests_insert ON public.attendance_correction_requests;
CREATE POLICY correction_requests_insert ON public.attendance_correction_requests
  FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company()
    AND (
      public.get_user_role() = 'admin'
      OR (
        public.get_user_role() IN ('employee', 'supervisor')
        AND emp_id = (SELECT emp_id FROM public.user_profiles WHERE auth_uid = auth.uid())
        AND employee_id = (SELECT employee_id FROM public.user_profiles WHERE auth_uid = auth.uid())
        AND status = 'pending'
        AND (resolved_approver_role, COALESCE(resolved_approver_user_profile_id::text, '')) IN (
          SELECT approver_role, COALESCE(approver_user_profile_id::text, '')
          FROM public.resolve_approver_for_employee(employee_id)
        )
      )
    )
  );

-- UPDATE: ผู้อนุมัติที่ถูกกำหนด (supervisor) หรือ admin/payroll เท่านั้นที่ทำการอนุมัติ/ปฏิเสธได้
DROP POLICY IF EXISTS correction_requests_update_approver ON public.attendance_correction_requests;
CREATE POLICY correction_requests_update_approver ON public.attendance_correction_requests
  FOR UPDATE
  USING (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
    OR (public.get_user_role() = 'supervisor' AND resolved_approver_user_profile_id = public.get_user_profile_id())
  )
  WITH CHECK (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
    OR (public.get_user_role() = 'supervisor' AND resolved_approver_user_profile_id = public.get_user_profile_id())
  );

DROP POLICY IF EXISTS correction_requests_delete_admin ON public.attendance_correction_requests;
CREATE POLICY correction_requests_delete_admin ON public.attendance_correction_requests
  FOR DELETE
  USING (public.get_user_role() = 'admin' AND company_id = public.get_user_company());

COMMIT;

-- =====================================================
-- PART 4: Storage policy - อนุญาตให้พนักงาน/หัวหน้างานอัปโหลดไฟล์แนบประกอบคำขอแก้ไขเวลา
-- (รูปภาพ/เอกสารอะไรก็ได้ที่ยืนยันว่ามาทำงานจริง) ลง bucket เดิม ภายใต้ prefix
-- "attendance_corrections/" (แยกจาก "leave_requests/" ที่อนุญาตไปแล้วในไฟล์ 12)
-- =====================================================

BEGIN;

DROP POLICY IF EXISTS announcement_attachments_employee_insert_correction ON storage.objects;
CREATE POLICY announcement_attachments_employee_insert_correction ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'announcement_attachments'
    AND public.get_user_role() IN ('employee', 'supervisor')
    AND (storage.foldername(name))[1] = 'attendance_corrections'
  );

COMMIT;

-- =====================================================
-- PART 5: เพิ่มสิทธิ์ INSERT บน attendance_logs ให้ admin/payroll/supervisor (site-matched)
-- ทำแทนพนักงานได้ - จำเป็นสำหรับ approveCorrectionRequest() กรณี "ลืมสแกนทั้งวัน" (ไม่มีแถวเดิม
-- ต้องสร้างใหม่) พบระหว่างออกแบบว่า attendance_insert_employee เดิม (01_payroll_migration_v2.sql)
-- อนุญาตเฉพาะ emp_id ของตัวเองเท่านั้น ไม่มี policy ให้ admin/supervisor insert แทนคนอื่นเลย
-- ขอบเขตสอดคล้องกับสิทธิ์ UPDATE ที่ admin/supervisor มีอยู่แล้วบนตารางนี้ (attendance_update_supervisor)
-- =====================================================

BEGIN;

DROP POLICY IF EXISTS attendance_insert_admin_supervisor ON public.attendance_logs;
CREATE POLICY attendance_insert_admin_supervisor ON public.attendance_logs
  FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
    OR (
      public.get_user_role() = 'supervisor'
      AND client_id IN (SELECT client_id FROM public.supervisor_client_assignments WHERE user_profile_id = public.get_user_profile_id())
    )
  );

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT proname FROM pg_proc WHERE proname = 'resolve_approver_for_employee';
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'attendance_correction_requests';
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'attendance_logs' AND policyname LIKE '%admin_supervisor%';
