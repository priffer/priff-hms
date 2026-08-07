-- =====================================================
-- database/28_notifications_self_delete.sql
-- Admin/ESS UI feedback (session นี้): เพิ่มปุ่มลบการแจ้งเตือนในทั้ง Admin Portal และ ESS
--
-- บริบท: RLS เดิม (21_notifications.sql) อนุญาตให้ลบได้เฉพาะ role='admin' เท่านั้น
-- (notifications_delete_admin) ทำให้พนักงาน/หัวหน้างาน/payroll ลบการแจ้งเตือนของตัวเองไม่ได้เลย
--
-- การตัดสินใจ: อนุญาตให้ผู้รับ (recipient) ลบการแจ้งเตือนของตัวเองได้เสมอ ไม่ว่า role ใด
-- (การลบแค่ notification record ไม่กระทบข้อมูลจริงใน ot_requests/leave_requests/advance_payments
-- ที่เป็นต้นทาง - แค่ซ่อนการแจ้งเตือนออกจากรายการของตัวเอง ความเสี่ยงต่ำ ไม่ใช่การตัดสินใจ
-- เกี่ยวกับตัวเลขคำนวณ/กฎหมายแรงงานที่ต้องถามก่อน) - เก็บ policy admin เดิมไว้ควบคู่กัน
-- (Postgres รวม policy แบบ FOR DELETE หลายอันด้วย OR โดยอัตโนมัติ)
--
-- Idempotent: DROP POLICY IF EXISTS ก่อน CREATE เสมอ
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

BEGIN;

DROP POLICY IF EXISTS notifications_delete_own ON public.notifications;
CREATE POLICY notifications_delete_own ON public.notifications
  FOR DELETE
  USING (recipient_user_profile_id = public.get_user_profile_id());

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.notifications'::regclass;
