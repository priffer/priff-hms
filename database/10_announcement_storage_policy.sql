-- =====================================================
-- database/10_announcement_storage_policy.sql
-- ESS Redesign (รอบ 2): เพิ่ม RLS policy บน storage.objects สำหรับ bucket
-- "announcement_attachments" (สร้าง bucket แล้วผ่าน scripts/create-storage-bucket.js
-- แต่ bucket แค่ public=true ไม่ได้แปลว่าอัปโหลด/แก้ไข/ลบได้อัตโนมัติ -
-- Supabase Storage ยังคง enforce RLS บน storage.objects เสมอ)
--
-- พบระหว่างทดสอบจริง: แอดมินอัปโหลด PDF แนบประกาศไม่ได้ เพราะยังไม่มี policy อนุญาต INSERT
-- เลย ("new row violates row-level security policy")
--
-- Policy: อ่านได้ทุกคน (bucket เป็น public read อยู่แล้ว แต่กำหนด policy ชัดเจนไว้ด้วย
-- กันกรณี public flag ถูกปิดในอนาคต), เขียน/แก้ไข/ลบได้เฉพาะ admin/payroll (สอดคล้องกับ
-- ตาราง announcements ที่จัดการได้เฉพาะ 2 role นี้)
--
-- Idempotent: DROP POLICY IF EXISTS ก่อนสร้างใหม่เสมอ
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

BEGIN;

DROP POLICY IF EXISTS announcement_attachments_public_read ON storage.objects;
CREATE POLICY announcement_attachments_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'announcement_attachments');

DROP POLICY IF EXISTS announcement_attachments_admin_payroll_insert ON storage.objects;
CREATE POLICY announcement_attachments_admin_payroll_insert ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'announcement_attachments' AND public.get_user_role() IN ('admin', 'payroll'));

DROP POLICY IF EXISTS announcement_attachments_admin_payroll_update ON storage.objects;
CREATE POLICY announcement_attachments_admin_payroll_update ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'announcement_attachments' AND public.get_user_role() IN ('admin', 'payroll'));

DROP POLICY IF EXISTS announcement_attachments_admin_payroll_delete ON storage.objects;
CREATE POLICY announcement_attachments_admin_payroll_delete ON storage.objects
  FOR DELETE
  USING (bucket_id = 'announcement_attachments' AND public.get_user_role() IN ('admin', 'payroll'));

COMMIT;

-- =====================================================
-- Verification query (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage'
--   AND policyname LIKE 'announcement_attachments%';
