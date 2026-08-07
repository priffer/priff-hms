-- =====================================================
-- database/36_payroll_period_approval_workflow.sql
-- Payroll Engine Milestone 4 (ต่อ): Approval Workflow สำหรับ payroll_periods
--   draft/open -> submitted -> approved -> locked  (+ "ส่งกลับแก้ไข": submitted -> open)
--
-- การตัดสินใจที่ยืนยันกับ user แล้ว (ask_user ใน session นี้):
--   - แยกสิทธิ์ตามขั้นตอน: role 'payroll' เท่านั้นที่ submit ได้, role 'admin' เท่านั้นที่
--     approve/reject/lock ได้ (บังคับในตัวฟังก์ชัน ไม่ใช่แค่ RLS)
--   - State machine อยู่ระดับ payroll_periods (ไม่ใช่ระดับ payroll_runs) - approve/lock ทั้งงวด
--     พร้อมกัน ใช้ payroll_runs.status ตามไปด้วยเพื่อความสอดคล้อง (sync กับ run ล่าสุดของงวดนั้น)
--   - Submit ได้ก็ต่อเมื่อทุก payroll_lines ของ run ล่าสุดในงวดนั้นเป็น 'approved' หมดแล้ว
--     (เข้มงวดสุด - บังคับตรวจทีละคนจนครบก่อนส่งให้ admin)
--   - มีปุ่ม "ส่งกลับแก้ไข" (reject): submitted -> open, payroll_lines ที่ approved กลับเป็น
--     pending ทั้งหมด (รวมถึง payroll_payslips.status กลับเป็น draft) ให้เจ้าหน้าที่ payroll แก้ไขใหม่
--
-- Attendance lock: trigger fn_attendance_modify_allowed() (01_payroll_migration_v2.sql) ล็อก
-- attendance_logs ของช่วงวันที่ที่งวดมีสถานะ IN ('approved','locked') อยู่แล้ว - ฟังก์ชันในไฟล์นี้
-- ไม่ต้องแก้ trigger นั้น เพียงทำให้ status ของ payroll_periods เดินตาม state machine ถูกต้อง
--
-- Idempotent: CREATE OR REPLACE FUNCTION ทั้งหมด, DROP POLICY IF EXISTS ก่อน CREATE POLICY
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

BEGIN;

-- ---------------------------------------------------------------
-- 1) fn_payroll_period_submit: payroll เท่านั้น, open -> submitted
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_payroll_period_submit(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period record;
  v_run_id uuid;
  v_unapproved_count int;
BEGIN
  IF public.get_user_role() <> 'payroll' THEN
    RAISE EXCEPTION 'มีเฉพาะเจ้าหน้าที่ payroll เท่านั้นที่ส่งงวดเงินเดือนได้';
  END IF;

  SELECT * INTO v_period FROM public.payroll_periods WHERE id = p_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payroll_periods % not found', p_period_id;
  END IF;
  IF v_period.company_id <> public.get_user_company() THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงงวดเงินเดือนของบริษัทนี้';
  END IF;
  IF v_period.status <> 'open' THEN
    RAISE EXCEPTION 'ส่งงวดได้เฉพาะสถานะ "เปิดรอบ" เท่านั้น (สถานะปัจจุบัน: %)', v_period.status;
  END IF;

  -- หา run ล่าสุดของงวดนี้ (ถ้ารันซ้ำหลายครั้งจะยึด run ล่าสุด)
  SELECT id INTO v_run_id FROM public.payroll_runs
  WHERE period_id = p_period_id
  ORDER BY created_at DESC LIMIT 1;

  IF v_run_id IS NULL THEN
    RAISE EXCEPTION 'ยังไม่ได้รันคำนวณเงินเดือนสำหรับงวดนี้';
  END IF;

  SELECT COUNT(1) INTO v_unapproved_count
  FROM public.payroll_lines
  WHERE payroll_run_id = v_run_id AND pay_status <> 'approved';

  IF v_unapproved_count > 0 THEN
    RAISE EXCEPTION 'ยังมีรายการพนักงาน % รายที่ยังไม่ได้อนุมัติ กรุณาอนุมัติให้ครบก่อนส่งงวด', v_unapproved_count;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.payroll_lines WHERE payroll_run_id = v_run_id) THEN
    RAISE EXCEPTION 'run นี้ยังไม่มีรายการพนักงานเลย ไม่สามารถส่งงวดเปล่าได้';
  END IF;

  UPDATE public.payroll_periods
  SET status = 'submitted', submitted_by = auth.uid(), updated_at = timezone('utc'::text, now())
  WHERE id = p_period_id;

  UPDATE public.payroll_runs
  SET status = 'submitted', submitted_by = auth.uid(), updated_at = timezone('utc'::text, now())
  WHERE id = v_run_id;
END;
$$;

-- ---------------------------------------------------------------
-- 2) fn_payroll_period_approve: admin เท่านั้น, submitted -> approved
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_payroll_period_approve(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period record;
  v_run_id uuid;
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'มีเฉพาะ admin เท่านั้นที่อนุมัติงวดเงินเดือนได้';
  END IF;

  SELECT * INTO v_period FROM public.payroll_periods WHERE id = p_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payroll_periods % not found', p_period_id;
  END IF;
  IF v_period.company_id <> public.get_user_company() THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงงวดเงินเดือนของบริษัทนี้';
  END IF;
  IF v_period.status <> 'submitted' THEN
    RAISE EXCEPTION 'อนุมัติได้เฉพาะงวดที่ถูกส่งมาแล้วเท่านั้น (สถานะปัจจุบัน: %)', v_period.status;
  END IF;

  SELECT id INTO v_run_id FROM public.payroll_runs
  WHERE period_id = p_period_id
  ORDER BY created_at DESC LIMIT 1;

  UPDATE public.payroll_periods
  SET status = 'approved', approved_by = auth.uid(), approved_at = timezone('utc'::text, now()), updated_at = timezone('utc'::text, now())
  WHERE id = p_period_id;

  IF v_run_id IS NOT NULL THEN
    UPDATE public.payroll_runs
    SET status = 'approved', approved_by = auth.uid(), approved_at = timezone('utc'::text, now()), updated_at = timezone('utc'::text, now())
    WHERE id = v_run_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------
-- 3) fn_payroll_period_reject: admin เท่านั้น, submitted -> open ("ส่งกลับแก้ไข")
--    เอา payroll_lines ที่ approved กลับเป็น pending และ payslips กลับเป็น draft
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_payroll_period_reject(p_period_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period record;
  v_run_id uuid;
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'มีเฉพาะ admin เท่านั้นที่ส่งงวดเงินเดือนกลับแก้ไขได้';
  END IF;

  SELECT * INTO v_period FROM public.payroll_periods WHERE id = p_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payroll_periods % not found', p_period_id;
  END IF;
  IF v_period.company_id <> public.get_user_company() THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงงวดเงินเดือนของบริษัทนี้';
  END IF;
  IF v_period.status <> 'submitted' THEN
    RAISE EXCEPTION 'ส่งกลับแก้ไขได้เฉพาะงวดที่อยู่ในสถานะ "ส่งตรวจแล้ว" เท่านั้น (สถานะปัจจุบัน: %)', v_period.status;
  END IF;

  SELECT id INTO v_run_id FROM public.payroll_runs
  WHERE period_id = p_period_id
  ORDER BY created_at DESC LIMIT 1;

  UPDATE public.payroll_periods
  SET status = 'open', submitted_by = NULL, updated_at = timezone('utc'::text, now())
  WHERE id = p_period_id;

  IF v_run_id IS NOT NULL THEN
    UPDATE public.payroll_runs
    SET status = 'draft', submitted_by = NULL, updated_at = timezone('utc'::text, now())
    WHERE id = v_run_id;

    UPDATE public.payroll_lines
    SET pay_status = 'pending', remarks = CASE WHEN p_reason IS NOT NULL THEN 'ส่งกลับแก้ไข: ' || p_reason ELSE remarks END, updated_at = timezone('utc'::text, now())
    WHERE payroll_run_id = v_run_id AND pay_status = 'approved';

    UPDATE public.payroll_payslips
    SET status = 'draft', updated_at = timezone('utc'::text, now())
    WHERE payroll_run_id = v_run_id AND status = 'approved';
  END IF;
END;
$$;

-- ---------------------------------------------------------------
-- 4) fn_payroll_period_lock: admin เท่านั้น, approved -> locked (จ่ายเงินแล้ว, ล็อกถาวร)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_payroll_period_lock(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period record;
  v_run_id uuid;
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'มีเฉพาะ admin เท่านั้นที่ล็อกงวดเงินเดือนได้';
  END IF;

  SELECT * INTO v_period FROM public.payroll_periods WHERE id = p_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payroll_periods % not found', p_period_id;
  END IF;
  IF v_period.company_id <> public.get_user_company() THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงงวดเงินเดือนของบริษัทนี้';
  END IF;
  IF v_period.status <> 'approved' THEN
    RAISE EXCEPTION 'ล็อกได้เฉพาะงวดที่อนุมัติแล้วเท่านั้น (สถานะปัจจุบัน: %)', v_period.status;
  END IF;

  SELECT id INTO v_run_id FROM public.payroll_runs
  WHERE period_id = p_period_id
  ORDER BY created_at DESC LIMIT 1;

  UPDATE public.payroll_periods
  SET status = 'locked', locked_at = timezone('utc'::text, now()), updated_at = timezone('utc'::text, now())
  WHERE id = p_period_id;

  IF v_run_id IS NOT NULL THEN
    UPDATE public.payroll_runs
    SET status = 'locked', locked_at = timezone('utc'::text, now()), updated_at = timezone('utc'::text, now())
    WHERE id = v_run_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------
-- 5) RLS: raw UPDATE บน payroll_periods/payroll_runs จำกัดเฉพาะ admin เท่านั้น
--    (การเปลี่ยนสถานะจริงต้องผ่านฟังก์ชัน SECURITY DEFINER ด้านบนซึ่งบังคับ role ในตัวเองแล้ว
--    - payroll role ยังคง SELECT/INSERT ได้ตามเดิม เพื่อสร้างงวด/ดูรายการ)
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS periods_payroll_admin ON public.payroll_periods;
DROP POLICY IF EXISTS periods_select_payroll_admin ON public.payroll_periods;
DROP POLICY IF EXISTS periods_insert_payroll_admin ON public.payroll_periods;
DROP POLICY IF EXISTS periods_update_admin_only ON public.payroll_periods;
DROP POLICY IF EXISTS periods_delete_admin_only ON public.payroll_periods;

CREATE POLICY periods_select_payroll_admin ON public.payroll_periods
  FOR SELECT
  USING (public.get_user_company() = company_id AND (public.get_user_role() IN ('payroll','admin')));

CREATE POLICY periods_insert_payroll_admin ON public.payroll_periods
  FOR INSERT
  WITH CHECK (public.get_user_company() = company_id AND (public.get_user_role() IN ('payroll','admin')));

-- Raw UPDATE (เช่น แก้ pay_date ผิด) จำกัดเฉพาะ admin - การเปลี่ยน status จริงใช้ฟังก์ชันด้านบน
CREATE POLICY periods_update_admin_only ON public.payroll_periods
  FOR UPDATE
  USING (public.get_user_company() = company_id AND public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_company() = company_id AND public.get_user_role() = 'admin');

CREATE POLICY periods_delete_admin_only ON public.payroll_periods
  FOR DELETE
  USING (public.get_user_company() = company_id AND public.get_user_role() = 'admin');

DROP POLICY IF EXISTS runs_payroll_admin ON public.payroll_runs;
DROP POLICY IF EXISTS runs_select_payroll_admin ON public.payroll_runs;
DROP POLICY IF EXISTS runs_insert_payroll_admin ON public.payroll_runs;
DROP POLICY IF EXISTS runs_update_admin_only ON public.payroll_runs;
DROP POLICY IF EXISTS runs_delete_admin_only ON public.payroll_runs;

CREATE POLICY runs_select_payroll_admin ON public.payroll_runs
  FOR SELECT
  USING (public.get_user_company() = company_id AND (public.get_user_role() IN ('payroll','admin')));

CREATE POLICY runs_insert_payroll_admin ON public.payroll_runs
  FOR INSERT
  WITH CHECK (public.get_user_company() = company_id AND (public.get_user_role() IN ('payroll','admin')));

CREATE POLICY runs_update_admin_only ON public.payroll_runs
  FOR UPDATE
  USING (public.get_user_company() = company_id AND public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_company() = company_id AND public.get_user_role() = 'admin');

CREATE POLICY runs_delete_admin_only ON public.payroll_runs
  FOR DELETE
  USING (public.get_user_company() = company_id AND public.get_user_role() = 'admin');

-- fn_run_payroll_period() ใช้ SECURITY DEFINER อยู่แล้ว (27_payroll_engine.sql) จึง INSERT
-- payroll_runs ใหม่ได้แม้ policy runs_insert_payroll_admin จะจำกัด role - ฟังก์ชันนั้น bypass RLS
-- อยู่แล้วตามปกติของ SECURITY DEFINER แต่ยังคง WITH CHECK role ไว้เผื่อมีการ insert ตรงจาก client

-- payroll_lines.pay_status: raw UPDATE ยังคงอนุญาต payroll/admin ตามเดิม (approveLine/markLinePaid
-- ใน admin-payroll.js ยังทำงานผ่าน UPDATE ตรงได้ - ไม่ใช่ขั้นตอนที่ต้องแยกสิทธิ์ตาม milestone นี้)

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT proname FROM pg_proc WHERE proname LIKE 'fn_payroll_period_%';
-- SELECT id, status, submitted_by, approved_by, approved_at, locked_at FROM public.payroll_periods ORDER BY period_start DESC LIMIT 5;
