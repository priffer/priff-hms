-- =====================================================
-- database/24_weekly_rest_day.sql
-- Payroll Engine Milestone 4 (prerequisite): เพิ่ม weekly_rest_day ให้ employee_shift_assignments
--
-- บริบท (ตัดสินใจร่วมกับ user ผ่าน ask_user ใน session นี้):
--   Payroll Engine ต้องแยกประเภท OT2 (ทำงานวันหยุดประจำสัปดาห์ x2) ออกจาก OT15 (ทำงานเกินเวลา
--   วันทำงานปกติ x1.5) ตาม docs/payroll-architecture.md §4.2 แต่ระบบไม่เคยมีข้อมูล "วันหยุด
--   ประจำสัปดาห์" ของพนักงานแต่ละคนมาก่อนเลย (มีแค่ company_holidays/client_holidays สำหรับ
--   วันนักขัตฤกษ์ ซึ่งใช้กับ OT3 เท่านั้น)
--
--   User ยืนยันว่าพนักงาน 2 กลุ่มมีวันหยุดต่างกัน:
--     - พนักงานฝ่ายปฏิบัติการ (operations): หยุดตามปฏิทินของไซต์ลูกค้าที่ประจำอยู่ (ยังไม่มี
--       ปฏิทินลูกค้าที่เป็นระบบจริงตอนนี้ - เตรียมโครงสร้างรอไว้ก่อน)
--     - พนักงานฝ่ายออฟฟิศ/บริหาร (office): หยุดตามปฏิทินบริษัท (weekly_rest_day = Sunday เป็นค่าเริ่มต้น)
--
--   ออกแบบผูก weekly_rest_day ไว้ที่ employee_shift_assignments (ไม่ใช่ตารางใหม่) เพราะตาราง
--   นี้มี effective_from/effective_to อยู่แล้วสำหรับติดตามการเปลี่ยนกะ/ไซต์ของพนักงานแต่ละคน -
--   วันหยุดประจำสัปดาห์ก็เปลี่ยนได้ตามไซต์ที่ย้ายไปเช่นกัน จึงสอดคล้องกับ pattern เดิม
--
--   ถ้า weekly_rest_day เป็น NULL (ยังไม่ได้ตั้งค่า - ส่วนใหญ่จะเป็นพนักงานปฏิบัติการที่รอ
--   ปฏิทินลูกค้าจริงในอนาคต) Payroll Engine (26_payroll_engine.sql) จะ "ไม่เดา" ให้ - ถือว่าวันนั้น
--   เป็นวันทำงานปกติ (OT15 เท่านั้น) และบันทึกหมายเหตุ needs_rest_day_config ไว้ใน
--   attendance_ot_details.description เพื่อให้ admin ตามไปตั้งค่าเพิ่มทีหลังโดยไม่กระทบ logic คำนวณ
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT/POLICY IF EXISTS ก่อนสร้างใหม่เสมอ
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

BEGIN;

-- 0 = อาทิตย์, 1 = จันทร์, ... 6 = เสาร์ (ตรงกับ EXTRACT(DOW FROM date) ของ Postgres)
ALTER TABLE public.employee_shift_assignments
  ADD COLUMN IF NOT EXISTS weekly_rest_day integer; -- NULL = ยังไม่ได้ตั้งค่า (ไม่เดา - ดู payroll engine)

ALTER TABLE public.employee_shift_assignments DROP CONSTRAINT IF EXISTS employee_shift_assignments_rest_day_check;
ALTER TABLE public.employee_shift_assignments ADD CONSTRAINT employee_shift_assignments_rest_day_check
  CHECK (weekly_rest_day IS NULL OR (weekly_rest_day >= 0 AND weekly_rest_day <= 6));

COMMENT ON COLUMN public.employee_shift_assignments.weekly_rest_day IS
  'วันหยุดประจำสัปดาห์ของพนักงานคนนี้ (0=อาทิตย์..6=เสาร์). พนักงานออฟฟิศ default=0 (อาทิตย์) ตามปฏิทินบริษัท. '
  'พนักงานปฏิบัติการ ตั้งตามปฏิทินไซต์ลูกค้าที่ประจำ (รอระบบปฏิทินลูกค้าจริงในอนาคต - NULL ไปก่อนถ้ายังไม่ทราบ). '
  'NULL = Payroll Engine จะไม่เดา ถือเป็นวันทำงานปกติ (OT15 เท่านั้น) และ flag ไว้ให้ admin ตามตั้งค่า.';

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'employee_shift_assignments' AND column_name = 'weekly_rest_day';
