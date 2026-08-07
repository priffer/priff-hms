-- =====================================================
-- database/19_fix_attendance_delete_trigger.sql
-- Bug fix (พบระหว่างทำความสะอาดข้อมูลทดสอบในรอบนี้ ไม่เกี่ยวกับฟีเจอร์ที่กำลังทำ):
--
-- fn_attendance_modify_allowed() (นิยามใน 01_payroll_migration_v2.sql PART 5.4) เป็น
-- BEFORE UPDATE OR DELETE trigger ที่อ้างอิง NEW.company_id / NEW.work_date แบบไม่มีเงื่อนไข
-- แล้ว RETURN NEW ท้ายฟังก์ชันเสมอ - แต่ตอน DELETE นั้น NEW เป็น NULL เสมอ (Postgres trigger
-- semantics) ทำให้:
--   1) WHERE clause เทียบกับ NEW.company_id/work_date ที่เป็น NULL ไม่ match อะไรเลย (v_count=0
--      เสมอ) เลยไม่เคย RAISE EXCEPTION แจ้งเตือนเรื่อง locked period ตอน DELETE จริงๆ
--   2) RETURN NEW ที่เป็น NULL ใน BEFORE DELETE trigger = สัญญาณบอก Postgres ให้ "ยกเลิกการ
--      ลบแถวนี้แบบเงียบๆ" (ไม่ error, แค่ affected rows = 0) เท่ากับว่า "ไม่มีใครลบแถวใน
--      attendance_logs ได้เลยจริงๆ" ทั้งที่มี DELETE policy (attendance_delete_admin_only)
--      อนุญาต admin ไว้อยู่แล้ว - เป็น bug ที่ทำให้ policy นั้นใช้งานไม่ได้จริง
--
-- แก้ไข: เช็ค TG_OP ก่อน ถ้าเป็น DELETE ให้ใช้ OLD.company_id/OLD.work_date แทน และ
-- RETURN OLD (ไม่ใช่ NEW) - ตาม pattern มาตรฐานของ Postgres trigger ที่ต้อง handle
-- UPDATE/DELETE แยกกัน ไม่ใช่การแก้ payroll calculation logic ใดๆ (แค่แก้ locking guard
-- ที่พังอยู่ก่อนแล้ว) จึงไม่จำเป็นต้องปรึกษาเรื่อง Payroll Engine ตามกฎของโปรเจกต์
--
-- Idempotent: CREATE OR REPLACE FUNCTION
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_attendance_modify_allowed() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
  v_company_id text;
  v_work_date date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_company_id := OLD.company_id;
    v_work_date := OLD.work_date;
  ELSE
    v_company_id := NEW.company_id;
    v_work_date := NEW.work_date;
  END IF;

  SELECT COUNT(1) INTO v_count
  FROM public.payroll_periods pp
  WHERE pp.company_id = v_company_id
    AND pp.period_start <= v_work_date
    AND pp.period_end >= v_work_date
    AND pp.status IN ('approved','locked');

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Attendance record for date % is locked by payroll period', v_work_date;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- ทดสอบ: DELETE FROM attendance_logs WHERE id = '<some test row not in a locked period>'; ควรลบได้จริงแล้ว
