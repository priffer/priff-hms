-- =====================================================
-- database/21_notifications.sql
-- ESS Redesign (รอบ 9): ระบบแจ้งเตือนกลาง (in-app) สำหรับคำขอ OT / ลา / แก้ไขเวลา
--
-- บริบท: user ถามเรื่องแจ้งเตือนอีเมล/LINE - ยืนยันแล้วว่ามีบัญชี Resend + LINE OA พร้อมอยู่
-- แล้ว แต่ "ยังไม่อยากเชื่อมต่อจริงตอนนี้" ขอให้ทำ "โครงสร้างข้อมูลรอไว้ก่อน" แล้วเก็บงาน
-- เชื่อมต่อ Resend/LINE จริงไว้ทำทีหลังหลังจากระบบหลักอื่นๆ เสร็จ
--
-- แนวทาง: ทำระบบแจ้งเตือนในแอป (in-app notifications) ให้ใช้งานได้จริง 100% ทันที
-- (ไม่ต้องพึ่งบริการภายนอกเลย) - ตาราง notifications มีคอลัมน์ email_dispatch_status /
-- line_dispatch_status เตรียมไว้ default 'not_configured' เป็นสัญญาณชัดเจนว่า "ยังไม่ได้เชื่อม"
-- เมื่อไหร่ที่ต่อยอด Edge Function/Webhook ไปยัง Resend/LINE จริง แค่เปลี่ยนค่าเป็น
-- 'pending' -> ให้ Edge Function คอย poll แถวที่ pending ไปส่งจริง แล้วอัปเดตเป็น 'sent'/'failed'
-- ไม่ต้องแก้ schema หรือ trigger เดิมเลย
--
-- Email/LINE ผูกอัตโนมัติ 100%: user_profiles.email มีอยู่แล้วทุกบัญชี (เป็นอีเมลเดียวกับที่ใช้
-- login Supabase Auth บังคับ NOT NULL) - ไม่ต้องให้แอดมินกรอกอีเมลเองแม้แต่คนเดียว ต่อยอด LINE
-- ในอนาคตจะต้องเพิ่ม column user_profiles.line_user_id (ให้พนักงานผูกบัญชี LINE เองผ่าน LINE
-- Login/OA ครั้งเดียว) - ยังไม่ทำในไฟล์นี้เพราะเป็นงานเชื่อมต่อจริงที่ยังไม่เริ่ม
--
-- Audience resolution (ใครควรได้รับแจ้งเตือน):
--   - ot_requests / attendance_correction_requests: ใช้ resolved_approver_user_profile_id ที่มี
--     อยู่แล้ว (จาก resolve_approver_for_employee()) ถ้า NULL (fallback ไม่มีหัวหน้างาน) แจ้ง
--     admin/payroll ทุกคนในบริษัทแทน
--   - leave_requests: ไม่มี resolved_approver column (RLS อนุมัติตาม department scope) จึงหา
--     หัวหน้างานที่ department_id ตรงกับพนักงานคนนั้นก่อน ถ้าไม่มีเลย fallback ไป admin/payroll
--   - ทุกกรณี: เปลี่ยนสถานะเป็น approved/rejected จะแจ้งกลับไปยังเจ้าของคำขอ (ผ่าน emp_id)
--   - ot_requests ที่ escalate เป็น pending_admin_review (หัวหน้างานอนุมัติแล้วแต่เกินเพดาน)
--     จะแจ้ง admin/payroll เพิ่มอีกชั้น
--
-- Idempotent: CREATE TABLE/FUNCTION IF NOT EXISTS หรือ OR REPLACE, DROP POLICY/TRIGGER IF EXISTS
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

-- =====================================================
-- PART 1: ตาราง notifications
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'comp_kc_clean',
  recipient_user_profile_id uuid NOT NULL REFERENCES public.user_profiles(id),
  category text NOT NULL, -- 'ot_request_pending' | 'ot_request_escalated' | 'ot_request_approved' | 'ot_request_rejected' |
                           -- 'correction_request_pending' | 'correction_request_approved' | 'correction_request_rejected' |
                           -- 'leave_request_pending' | 'leave_request_approved' | 'leave_request_rejected'
  title text NOT NULL,
  body text,
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamp with time zone,
  -- เตรียมไว้สำหรับต่อยอด Resend/LINE ในอนาคต - 'not_configured' = ยังไม่ได้เชื่อมต่อจริง
  -- (ค่าเริ่มต้นตอนนี้) เปลี่ยนเป็น 'pending' เมื่อเริ่มเชื่อมต่อจริงแล้วให้ Edge Function มา poll
  email_dispatch_status text NOT NULL DEFAULT 'not_configured',
  line_dispatch_status text NOT NULL DEFAULT 'not_configured',
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT notifications_email_status_check CHECK (email_dispatch_status IN ('not_configured', 'pending', 'sent', 'failed')),
  CONSTRAINT notifications_line_status_check CHECK (line_dispatch_status IN ('not_configured', 'pending', 'sent', 'failed'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications (recipient_user_profile_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_company ON public.notifications (company_id);
CREATE INDEX IF NOT EXISTS idx_notifications_source ON public.notifications (source_table, source_id);

COMMIT;

-- =====================================================
-- PART 2: RLS - อ่าน/mark-as-read เฉพาะของตัวเอง, admin เห็นทั้งหมด (สำหรับ debug/oversight)
-- ไม่มี INSERT policy ให้ client เลย - เขียนได้เฉพาะผ่าน trigger functions (SECURITY DEFINER)
-- ด้านล่างเท่านั้น กันพนักงานปลอมแปลงแจ้งเตือนหลอกกันเอง
-- =====================================================

BEGIN;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT
  USING (
    public.get_user_role() = 'admin'
    OR recipient_user_profile_id = public.get_user_profile_id()
  );

DROP POLICY IF EXISTS notifications_update_mark_read ON public.notifications;
CREATE POLICY notifications_update_mark_read ON public.notifications
  FOR UPDATE
  USING (recipient_user_profile_id = public.get_user_profile_id())
  WITH CHECK (recipient_user_profile_id = public.get_user_profile_id());

DROP POLICY IF EXISTS notifications_delete_admin ON public.notifications;
CREATE POLICY notifications_delete_admin ON public.notifications
  FOR DELETE
  USING (public.get_user_role() = 'admin' AND company_id = public.get_user_company());

COMMIT;

-- =====================================================
-- PART 3: Helper function - หา user_profile_id ของ admin/payroll ทั้งหมดในบริษัท (ใช้ fallback
-- เมื่อไม่มีหัวหน้างานที่ระบุตัวได้ - เรียกจากหลาย trigger ด้านล่าง)
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_get_admin_payroll_profile_ids(p_company_id text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.user_profiles WHERE company_id = p_company_id AND role IN ('admin', 'payroll');
$$;

COMMIT;

-- =====================================================
-- PART 4: Trigger - ot_requests
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_notify_ot_request_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester_profile_id uuid;
  v_admin_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.resolved_approver_user_profile_id IS NOT NULL THEN
      INSERT INTO public.notifications (company_id, recipient_user_profile_id, category, title, body, source_table, source_id)
      VALUES (NEW.company_id, NEW.resolved_approver_user_profile_id, 'ot_request_pending',
        'คำขอโอทีใหม่รอการอนุมัติ',
        format('พนักงาน %s ขอทำโอที %s ชม. วันที่ %s', NEW.emp_id, NEW.requested_hours, NEW.work_date),
        'ot_requests', NEW.id);
    ELSE
      FOR v_admin_id IN SELECT * FROM public.fn_get_admin_payroll_profile_ids(NEW.company_id) LOOP
        INSERT INTO public.notifications (company_id, recipient_user_profile_id, category, title, body, source_table, source_id)
        VALUES (NEW.company_id, v_admin_id, 'ot_request_pending',
          'คำขอโอทีใหม่รอการอนุมัติ (ไม่มีหัวหน้างานประจำไซต์)',
          format('พนักงาน %s ขอทำโอที %s ชม. วันที่ %s', NEW.emp_id, NEW.requested_hours, NEW.work_date),
          'ot_requests', NEW.id);
      END LOOP;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT id INTO v_requester_profile_id FROM public.user_profiles WHERE emp_id = NEW.emp_id LIMIT 1;

    IF NEW.status = 'pending_admin_review' THEN
      FOR v_admin_id IN SELECT * FROM public.fn_get_admin_payroll_profile_ids(NEW.company_id) LOOP
        INSERT INTO public.notifications (company_id, recipient_user_profile_id, category, title, body, source_table, source_id)
        VALUES (NEW.company_id, v_admin_id, 'ot_request_escalated',
          'คำขอโอทีเกินเพดาน - ต้องตรวจสอบเพิ่ม',
          format('พนักงาน %s หัวหน้างานอนุมัติแล้วแต่ยอด OT จะเกินเพดาน (สัปดาห์: %s ชม., เดือน: %s ชม.)', NEW.emp_id, NEW.projected_weekly_ot_hours, NEW.projected_monthly_ot_hours),
          'ot_requests', NEW.id);
      END LOOP;
    ELSIF NEW.status = 'approved' AND v_requester_profile_id IS NOT NULL THEN
      INSERT INTO public.notifications (company_id, recipient_user_profile_id, category, title, body, source_table, source_id)
      VALUES (NEW.company_id, v_requester_profile_id, 'ot_request_approved',
        'คำขอโอทีของคุณได้รับการอนุมัติแล้ว',
        format('คำขอโอทีวันที่ %s (%s ชม.) ได้รับการอนุมัติแล้ว', NEW.work_date, NEW.requested_hours),
        'ot_requests', NEW.id);
    ELSIF NEW.status = 'rejected' AND v_requester_profile_id IS NOT NULL THEN
      INSERT INTO public.notifications (company_id, recipient_user_profile_id, category, title, body, source_table, source_id)
      VALUES (NEW.company_id, v_requester_profile_id, 'ot_request_rejected',
        'คำขอโอทีของคุณไม่ได้รับการอนุมัติ',
        format('คำขอโอทีวันที่ %s ไม่ได้รับการอนุมัติ%s', NEW.work_date, CASE WHEN NEW.rejection_reason IS NOT NULL THEN ' - เหตุผล: ' || NEW.rejection_reason ELSE '' END),
        'ot_requests', NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_ot_request_change ON public.ot_requests;
CREATE TRIGGER trg_notify_ot_request_change
AFTER INSERT OR UPDATE ON public.ot_requests
FOR EACH ROW
EXECUTE FUNCTION public.fn_notify_ot_request_change();

COMMIT;

-- =====================================================
-- PART 5: Trigger - attendance_correction_requests (pattern เดียวกับ ot_requests)
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_notify_correction_request_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester_profile_id uuid;
  v_admin_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.resolved_approver_user_profile_id IS NOT NULL THEN
      INSERT INTO public.notifications (company_id, recipient_user_profile_id, category, title, body, source_table, source_id)
      VALUES (NEW.company_id, NEW.resolved_approver_user_profile_id, 'correction_request_pending',
        'คำขอแก้ไขเวลาใหม่รอการอนุมัติ',
        format('พนักงาน %s ขอแก้ไขเวลาวันที่ %s', NEW.emp_id, NEW.work_date),
        'attendance_correction_requests', NEW.id);
    ELSE
      FOR v_admin_id IN SELECT * FROM public.fn_get_admin_payroll_profile_ids(NEW.company_id) LOOP
        INSERT INTO public.notifications (company_id, recipient_user_profile_id, category, title, body, source_table, source_id)
        VALUES (NEW.company_id, v_admin_id, 'correction_request_pending',
          'คำขอแก้ไขเวลาใหม่รอการอนุมัติ (ไม่มีหัวหน้างานประจำไซต์)',
          format('พนักงาน %s ขอแก้ไขเวลาวันที่ %s', NEW.emp_id, NEW.work_date),
          'attendance_correction_requests', NEW.id);
      END LOOP;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT id INTO v_requester_profile_id FROM public.user_profiles WHERE emp_id = NEW.emp_id LIMIT 1;

    IF NEW.status = 'approved' AND v_requester_profile_id IS NOT NULL THEN
      INSERT INTO public.notifications (company_id, recipient_user_profile_id, category, title, body, source_table, source_id)
      VALUES (NEW.company_id, v_requester_profile_id, 'correction_request_approved',
        'คำขอแก้ไขเวลาของคุณได้รับการอนุมัติแล้ว',
        format('คำขอแก้ไขเวลาวันที่ %s ได้รับการอนุมัติแล้ว', NEW.work_date),
        'attendance_correction_requests', NEW.id);
    ELSIF NEW.status = 'rejected' AND v_requester_profile_id IS NOT NULL THEN
      INSERT INTO public.notifications (company_id, recipient_user_profile_id, category, title, body, source_table, source_id)
      VALUES (NEW.company_id, v_requester_profile_id, 'correction_request_rejected',
        'คำขอแก้ไขเวลาของคุณไม่ได้รับการอนุมัติ',
        format('คำขอแก้ไขเวลาวันที่ %s ไม่ได้รับการอนุมัติ%s', NEW.work_date, CASE WHEN NEW.rejection_reason IS NOT NULL THEN ' - เหตุผล: ' || NEW.rejection_reason ELSE '' END),
        'attendance_correction_requests', NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_correction_request_change ON public.attendance_correction_requests;
CREATE TRIGGER trg_notify_correction_request_change
AFTER INSERT OR UPDATE ON public.attendance_correction_requests
FOR EACH ROW
EXECUTE FUNCTION public.fn_notify_correction_request_change();

COMMIT;

-- =====================================================
-- PART 6: Trigger - leave_requests (ไม่มี resolved_approver column - หาหัวหน้างานจาก
-- department_id ของพนักงาน ถ้าไม่มีเลย fallback ไป admin/payroll)
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_notify_leave_request_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_department_id uuid;
  v_requester_profile_id uuid;
  v_supervisor_id uuid;
  v_admin_id uuid;
  v_found_supervisor boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT department_id INTO v_department_id FROM public.employees WHERE id = NEW.employee_id;

    IF v_department_id IS NOT NULL THEN
      FOR v_supervisor_id IN
        SELECT id FROM public.user_profiles WHERE company_id = NEW.company_id AND role = 'supervisor' AND department_id = v_department_id
      LOOP
        v_found_supervisor := true;
        INSERT INTO public.notifications (company_id, recipient_user_profile_id, category, title, body, source_table, source_id)
        VALUES (NEW.company_id, v_supervisor_id, 'leave_request_pending',
          'คำขอลางานใหม่รอการอนุมัติ',
          format('พนักงาน %s ยื่นลาวันที่ %s ถึง %s', NEW.emp_id, NEW.start_date, NEW.end_date),
          'leave_requests', NEW.id);
      END LOOP;
    END IF;

    IF NOT v_found_supervisor THEN
      FOR v_admin_id IN SELECT * FROM public.fn_get_admin_payroll_profile_ids(NEW.company_id) LOOP
        INSERT INTO public.notifications (company_id, recipient_user_profile_id, category, title, body, source_table, source_id)
        VALUES (NEW.company_id, v_admin_id, 'leave_request_pending',
          'คำขอลางานใหม่รอการอนุมัติ (ไม่มีหัวหน้างานประจำแผนก)',
          format('พนักงาน %s ยื่นลาวันที่ %s ถึง %s', NEW.emp_id, NEW.start_date, NEW.end_date),
          'leave_requests', NEW.id);
      END LOOP;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT id INTO v_requester_profile_id FROM public.user_profiles WHERE emp_id = NEW.emp_id LIMIT 1;

    IF NEW.status = 'approved' AND v_requester_profile_id IS NOT NULL THEN
      INSERT INTO public.notifications (company_id, recipient_user_profile_id, category, title, body, source_table, source_id)
      VALUES (NEW.company_id, v_requester_profile_id, 'leave_request_approved',
        'คำขอลางานของคุณได้รับการอนุมัติแล้ว',
        format('คำขอลาวันที่ %s ถึง %s ได้รับการอนุมัติแล้ว', NEW.start_date, NEW.end_date),
        'leave_requests', NEW.id);
    ELSIF NEW.status = 'rejected' AND v_requester_profile_id IS NOT NULL THEN
      INSERT INTO public.notifications (company_id, recipient_user_profile_id, category, title, body, source_table, source_id)
      VALUES (NEW.company_id, v_requester_profile_id, 'leave_request_rejected',
        'คำขอลางานของคุณไม่ได้รับการอนุมัติ',
        format('คำขอลาวันที่ %s ถึง %s ไม่ได้รับการอนุมัติ%s', NEW.start_date, NEW.end_date, CASE WHEN NEW.rejection_reason IS NOT NULL THEN ' - เหตุผล: ' || NEW.rejection_reason ELSE '' END),
        'leave_requests', NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_leave_request_change ON public.leave_requests;
CREATE TRIGGER trg_notify_leave_request_change
AFTER INSERT OR UPDATE ON public.leave_requests
FOR EACH ROW
EXECUTE FUNCTION public.fn_notify_leave_request_change();

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'notifications';
-- SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_notify_%';
