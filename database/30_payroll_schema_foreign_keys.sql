-- =====================================================
-- database/30_payroll_schema_foreign_keys.sql
-- Milestone 5 Phase 0: แก้บั๊ก "Could not find a relationship between 'payroll_lines' and
-- 'employees' in the schema cache" ที่ user เจอตอนกด "ดูรายละเอียด" ในหน้า admin-payroll.html
--
-- สาเหตุ: ทั้งชุดตาราง payroll_* ที่สร้างใน 01_payroll_migration_v2.sql ไม่มี Foreign Key
-- อ้างอิงตารางอื่นเลยสักตัว (employee_id/period_id/payroll_run_id/payroll_line_id เป็นแค่ uuid
-- เฉยๆ) ทำให้ Supabase PostgREST หาความสัมพันธ์ไม่เจอตอนสั่ง embed แบบ
-- .select('*, employees(full_name, emp_id)') หรือ .select('*, payroll_periods(...)')
--
-- ไฟล์นี้แก้เฉพาะโครงสร้าง (เพิ่ม FK) ไม่แตะตัวเลขคำนวณ/logic ใดๆ ทั้งสิ้น ความเสี่ยงต่ำมาก
-- (ถ้ามีข้อมูลกำพร้าอยู่ก่อนแล้วจะ error ตอนรัน - ต้องเคลียร์ข้อมูลทดสอบเก่าก่อน ซึ่งได้เคลียร์
-- ไปหมดแล้วระหว่าง session ก่อนหน้า)
--
-- Idempotent: ใช้ DO block เช็ค pg_constraint ก่อนเพิ่มทุกครั้ง (กัน error ถ้ารันซ้ำ)
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_runs_period_id_fkey') THEN
    ALTER TABLE public.payroll_runs
      ADD CONSTRAINT payroll_runs_period_id_fkey FOREIGN KEY (period_id) REFERENCES public.payroll_periods(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_lines_payroll_run_id_fkey') THEN
    ALTER TABLE public.payroll_lines
      ADD CONSTRAINT payroll_lines_payroll_run_id_fkey FOREIGN KEY (payroll_run_id) REFERENCES public.payroll_runs(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_lines_employee_id_fkey') THEN
    ALTER TABLE public.payroll_lines
      ADD CONSTRAINT payroll_lines_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_line_details_payroll_line_id_fkey') THEN
    ALTER TABLE public.payroll_line_details
      ADD CONSTRAINT payroll_line_details_payroll_line_id_fkey FOREIGN KEY (payroll_line_id) REFERENCES public.payroll_lines(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_payslips_payroll_line_id_fkey') THEN
    ALTER TABLE public.payroll_payslips
      ADD CONSTRAINT payroll_payslips_payroll_line_id_fkey FOREIGN KEY (payroll_line_id) REFERENCES public.payroll_lines(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_payslips_employee_id_fkey') THEN
    ALTER TABLE public.payroll_payslips
      ADD CONSTRAINT payroll_payslips_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_payslips_payroll_run_id_fkey') THEN
    ALTER TABLE public.payroll_payslips
      ADD CONSTRAINT payroll_payslips_payroll_run_id_fkey FOREIGN KEY (payroll_run_id) REFERENCES public.payroll_runs(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_ytd_summary_employee_id_fkey') THEN
    ALTER TABLE public.payroll_ytd_summary
      ADD CONSTRAINT payroll_ytd_summary_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_ot_details_employee_id_fkey') THEN
    ALTER TABLE public.attendance_ot_details
      ADD CONSTRAINT attendance_ot_details_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_ot_details_attendance_log_id_fkey') THEN
    ALTER TABLE public.attendance_ot_details
      ADD CONSTRAINT attendance_ot_details_attendance_log_id_fkey FOREIGN KEY (attendance_log_id) REFERENCES public.attendance_logs(id);
  END IF;
END $$;

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate)
-- =====================================================
-- SELECT conname, conrelid::regclass, confrelid::regclass FROM pg_constraint
-- WHERE conname LIKE 'payroll_%' OR conname LIKE 'attendance_ot_details_%';
