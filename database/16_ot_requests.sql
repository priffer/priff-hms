-- =====================================================
-- database/16_ot_requests.sql
-- ESS Redesign (รอบ 6): ฟีเจอร์ "ขอโอที" (OT Request) ต่อจาก attendance_correction_requests
--
-- Flow ที่ยืนยันกับ user แล้ว:
--   1) พนักงานยื่นคำขอโอทีล่วงหน้า (วันที่/เวลา/ชั่วโมงที่ขอ/เหตุผล)
--   2) resolve_approver_for_employee() (จาก 15_attendance_correction_requests.sql) หาผู้อนุมัติ
--      ชั้นแรกให้อัตโนมัติ - หัวหน้างานประจำไซต์ ถ้าไม่มี (ไซต์ไม่มีหัวหน้างานเลย เช่น แม่บ้าน
--      คนเดียว) fallback ไปแอดมิน/payroll ตรงๆ ทันที (ไม่ต้องมีใครมารออนุมัติเพิ่ม)
--   3) Safety net: ถ้าคำขอนี้จะทำให้ยอด OT สะสมของพนักงานคนนั้นในสัปดาห์เดียวกันเกิน 36 ชม.
--      (ใช้ pattern เดียวกับ attendance_logs.weekly_ot_flagged ที่มีอยู่แล้ว) หรือเกินเพดาน
--      รายเดือนที่ตั้งค่าไว้ - บังคับให้ admin/payroll ต้องมาตรวจสอบเพิ่มอีกชั้นเสมอ แม้ว่า
--      หัวหน้างานจะอนุมัติไปแล้วก็ตาม (status='pending_admin_review' ก่อนจะเป็น 'approved' จริง)
--   4) เพดานชั่วโมงต่อวัน/สัปดาห์/เดือน ตั้งค่าได้โดย admin ผ่าน ot_policy_settings
--
-- หมายเหตุสำคัญ: ฟีเจอร์นี้เป็นการขออนุมัติล่วงหน้า (pre-authorization) ไม่ใช่การแก้ไข
-- attendance_logs โดยตรง - ไม่แตะ Payroll Engine calculation logic ใดๆ ทั้งสิ้น
-- (attendance_ot_details/weekly_ot_hours ยังคงเป็นแหล่งความจริงเดียวสำหรับคำนวณค่าโอทีจริง
-- ตามที่เกิดขึ้นจริงในระบบลงเวลา ตามที่ระบุไว้ใน docs/payroll-architecture.md)
--
-- Idempotent: CREATE TABLE/FUNCTION IF NOT EXISTS หรือ OR REPLACE, DROP POLICY/TRIGGER IF EXISTS ก่อนสร้างใหม่
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

-- =====================================================
-- PART 1: ot_policy_settings - เพดานชั่วโมงโอทีที่ admin ตั้งค่าได้ (ต่อบริษัท)
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ot_policy_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL UNIQUE DEFAULT 'comp_kc_clean',
  daily_max_hours numeric NOT NULL DEFAULT 4,   -- เพดานชั่วโมงโอทีต่อวัน (hard cap - เกินไม่ให้ยื่นคำขอเลย)
  weekly_max_hours numeric NOT NULL DEFAULT 36, -- soft cap - เกินแล้วต้องให้ admin/payroll ตรวจสอบเพิ่ม (ใช้ค่าเดียวกับ weekly_ot_flagged เดิม)
  monthly_max_hours numeric NOT NULL DEFAULT 90, -- soft cap รายเดือน - เกินแล้วต้องให้ admin/payroll ตรวจสอบเพิ่มเช่นกัน
  updated_by uuid,
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ot_policy_settings_positive_check CHECK (daily_max_hours > 0 AND weekly_max_hours > 0 AND monthly_max_hours > 0)
);

-- ค่าเริ่มต้นของบริษัทหลัก ถ้ายังไม่มี
INSERT INTO public.ot_policy_settings (company_id)
VALUES ('comp_kc_clean')
ON CONFLICT (company_id) DO NOTHING;

COMMIT;

BEGIN;

ALTER TABLE public.ot_policy_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ot_policy_select_all ON public.ot_policy_settings;
CREATE POLICY ot_policy_select_all ON public.ot_policy_settings
  FOR SELECT
  USING (company_id = public.get_user_company());

DROP POLICY IF EXISTS ot_policy_manage_admin_payroll ON public.ot_policy_settings;
CREATE POLICY ot_policy_manage_admin_payroll ON public.ot_policy_settings
  FOR ALL
  USING (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company())
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company());

COMMIT;

-- =====================================================
-- PART 2: ot_requests table
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ot_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'comp_kc_clean',
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  emp_id text NOT NULL,
  work_date date NOT NULL,
  requested_start time,
  requested_end time,
  requested_hours numeric NOT NULL,
  reason text NOT NULL,
  attachment_url text,
  status text NOT NULL DEFAULT 'pending', -- pending, pending_admin_review, approved, rejected
  resolved_approver_role text NOT NULL,   -- 'supervisor' | 'admin' - snapshot ตอนสร้างคำขอ (ดู resolve_approver_for_employee())
  resolved_approver_user_profile_id uuid, -- snapshot user_profile_id ของหัวหน้างานที่ถูกกำหนด (ถ้ามี)
  requires_admin_review boolean NOT NULL DEFAULT false, -- คำนวณอัตโนมัติตอน insert (ดู fn_ot_request_precheck)
  projected_weekly_ot_hours numeric,  -- snapshot ยอด OT สะสม/สัปดาห์ ถ้าคำขอนี้ผ่าน (สำหรับ admin ดูประกอบการตัดสินใจ)
  projected_monthly_ot_hours numeric, -- snapshot ยอด OT สะสม/เดือน ถ้าคำขอนี้ผ่าน
  supervisor_approved_by uuid,
  supervisor_approved_at timestamp with time zone,
  admin_reviewed_by uuid,
  admin_reviewed_at timestamp with time zone,
  rejection_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone,
  CONSTRAINT ot_requests_hours_check CHECK (requested_hours > 0 AND requested_hours <= 24),
  CONSTRAINT ot_requests_status_check CHECK (status IN ('pending', 'pending_admin_review', 'approved', 'rejected'))
);
CREATE INDEX IF NOT EXISTS idx_ot_requests_employee ON public.ot_requests (employee_id);
CREATE INDEX IF NOT EXISTS idx_ot_requests_company_status ON public.ot_requests (company_id, status);
CREATE INDEX IF NOT EXISTS idx_ot_requests_approver ON public.ot_requests (resolved_approver_user_profile_id);

COMMIT;

-- =====================================================
-- PART 3: Pre-check trigger - บังคับ daily hard cap + คำนวณ requires_admin_review
-- อัตโนมัติจากเพดาน weekly/monthly ใน ot_policy_settings (กันพนักงาน/supervisor ส่งค่ามาปลอมได้
-- เพราะคำนวณฝั่ง DB ทั้งหมด ไม่เชื่อ payload จาก client)
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_ot_request_precheck()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy record;
  v_iso_week integer;
  v_month_start date;
  v_worked_weekly numeric := 0;
  v_pending_weekly numeric := 0;
  v_pending_monthly numeric := 0;
BEGIN
  SELECT * INTO v_policy FROM public.ot_policy_settings WHERE company_id = NEW.company_id LIMIT 1;
  IF NOT FOUND THEN
    -- ไม่มี config แถวสำหรับบริษัทนี้ - ใช้ค่า default เดียวกับ column default
    v_policy.daily_max_hours := 4;
    v_policy.weekly_max_hours := 36;
    v_policy.monthly_max_hours := 90;
  END IF;

  IF NEW.requested_hours > v_policy.daily_max_hours THEN
    RAISE EXCEPTION 'requested_hours (%) exceeds daily_max_hours (%) for company %', NEW.requested_hours, v_policy.daily_max_hours, NEW.company_id;
  END IF;

  v_iso_week := to_char(NEW.work_date, 'IW')::integer;
  v_month_start := date_trunc('month', NEW.work_date)::date;

  -- ยอด OT ที่ "ทำงานจริงแล้ว" ในสัปดาห์เดียวกัน (ใช้ pattern weekly_ot_hours ที่มีอยู่แล้ว)
  SELECT COALESCE(MAX(al.weekly_ot_hours), 0) INTO v_worked_weekly
  FROM public.attendance_logs al
  WHERE al.emp_id = NEW.emp_id AND al.company_id = NEW.company_id
    AND to_char(al.work_date, 'IW')::integer = v_iso_week
    AND date_trunc('week', al.work_date) = date_trunc('week', NEW.work_date);

  -- ยอดคำขอโอทีอื่นที่ยัง pending/approved อยู่ในสัปดาห์เดียวกัน (กันคำขอซ้อนกันดันยอดเกิน)
  SELECT COALESCE(SUM(r.requested_hours), 0) INTO v_pending_weekly
  FROM public.ot_requests r
  WHERE r.emp_id = NEW.emp_id AND r.company_id = NEW.company_id
    AND r.status IN ('pending', 'pending_admin_review', 'approved')
    AND date_trunc('week', r.work_date) = date_trunc('week', NEW.work_date)
    AND r.id IS DISTINCT FROM NEW.id;

  SELECT COALESCE(SUM(r.requested_hours), 0) INTO v_pending_monthly
  FROM public.ot_requests r
  WHERE r.emp_id = NEW.emp_id AND r.company_id = NEW.company_id
    AND r.status IN ('pending', 'pending_admin_review', 'approved')
    AND date_trunc('month', r.work_date) = v_month_start
    AND r.id IS DISTINCT FROM NEW.id;

  NEW.projected_weekly_ot_hours := v_worked_weekly + v_pending_weekly + NEW.requested_hours;
  NEW.projected_monthly_ot_hours := v_pending_monthly + NEW.requested_hours;

  NEW.requires_admin_review := (NEW.projected_weekly_ot_hours > v_policy.weekly_max_hours)
    OR (NEW.projected_monthly_ot_hours > v_policy.monthly_max_hours);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ot_request_precheck ON public.ot_requests;
CREATE TRIGGER trg_ot_request_precheck
BEFORE INSERT ON public.ot_requests
FOR EACH ROW
EXECUTE FUNCTION public.fn_ot_request_precheck();

COMMIT;

-- =====================================================
-- PART 4: RLS - เหมือน pattern attendance_correction_requests (15_attendance_correction_requests.sql)
-- =====================================================

BEGIN;

ALTER TABLE public.ot_requests ENABLE ROW LEVEL SECURITY;

-- SELECT: เจ้าของคำขอ, ผู้อนุมัติที่ถูกกำหนด (supervisor), admin/payroll เห็นทั้งหมดในบริษัท
-- (ครอบคลุมทั้งกรณี fallback ตรงไป admin และกรณี pending_admin_review หลัง supervisor อนุมัติแล้ว)
DROP POLICY IF EXISTS ot_requests_select ON public.ot_requests;
CREATE POLICY ot_requests_select ON public.ot_requests
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
DROP POLICY IF EXISTS ot_requests_insert ON public.ot_requests;
CREATE POLICY ot_requests_insert ON public.ot_requests
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

-- UPDATE: supervisor ที่ถูกกำหนดเป็นผู้อนุมัติชั้นแรกทำได้เฉพาะตอน status='pending' เท่านั้น
-- (กันไม่ให้ supervisor ไปแก้ไขคำขอที่อยู่ระหว่างตรวจสอบชั้น admin หรือปิดเรื่องแล้ว)
-- admin/payroll แก้ไขได้ทุกสถานะ (รับผิดชอบชั้น pending_admin_review และ fallback โดยตรง)
DROP POLICY IF EXISTS ot_requests_update_supervisor ON public.ot_requests;
CREATE POLICY ot_requests_update_supervisor ON public.ot_requests
  FOR UPDATE
  USING (
    public.get_user_role() = 'supervisor'
    AND resolved_approver_user_profile_id = public.get_user_profile_id()
    AND status = 'pending'
  )
  WITH CHECK (
    public.get_user_role() = 'supervisor'
    AND resolved_approver_user_profile_id = public.get_user_profile_id()
  );

DROP POLICY IF EXISTS ot_requests_update_admin_payroll ON public.ot_requests;
CREATE POLICY ot_requests_update_admin_payroll ON public.ot_requests
  FOR UPDATE
  USING (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
  )
  WITH CHECK (
    public.get_user_role() = 'admin'
    OR (public.get_user_role() = 'payroll' AND company_id = public.get_user_company())
  );

DROP POLICY IF EXISTS ot_requests_delete_admin ON public.ot_requests;
CREATE POLICY ot_requests_delete_admin ON public.ot_requests
  FOR DELETE
  USING (public.get_user_role() = 'admin' AND company_id = public.get_user_company());

COMMIT;

-- =====================================================
-- PART 5: Storage policy - อนุญาตแนบหลักฐานประกอบคำขอโอที (เช่น ใบสั่งงานเร่งด่วน)
-- ลง bucket เดิม ภายใต้ prefix "ot_requests/"
-- =====================================================

BEGIN;

DROP POLICY IF EXISTS announcement_attachments_employee_insert_ot ON storage.objects;
CREATE POLICY announcement_attachments_employee_insert_ot ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'announcement_attachments'
    AND public.get_user_role() IN ('employee', 'supervisor')
    AND (storage.foldername(name))[1] = 'ot_requests'
  );

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT * FROM public.ot_policy_settings;
-- SELECT proname FROM pg_proc WHERE proname = 'fn_ot_request_precheck';
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'ot_requests';
