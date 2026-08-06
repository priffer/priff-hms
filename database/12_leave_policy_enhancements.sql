-- =====================================================
-- database/12_leave_policy_enhancements.sql
-- ESS Redesign (รอบ 4): ปรับ leave_types ให้ตรงกับระเบียบสวัสดิการจริงของบริษัท
-- (เอกสาร "สวัสดิการที่จ่ายพร้อมเงินเดือน" ระเบียบที่ 7-14 ที่ผู้ใช้แนบมา)
--
-- บริบท: ระบบลาเดิม (06_leave_management.sql) ใช้โมเดล "โควตาต่อปีปฏิทิน" (ม.ค.-ธ.ค.)
-- แบบเดียวกันหมดทุกประเภทลา ซึ่งไม่ตรงกับนโยบายจริงที่พบว่า:
--   1) ลาพักร้อน (annual) ใช้ "ปีของการทำงาน" ของบริษัท = 16 ธ.ค. ถึง 16 ธ.ค. ปีถัดไป
--      (ไม่ใช่ปีปฏิทิน) + ปีแรก prorate ตามเดือนเริ่มงาน + ปีถัดไปขึ้นกับอายุงานเป็นขั้นบันได
--   2) ลาบวช/ลาแต่งงาน/ลากรณีภรรยาคลอดบุตร/ลางานศพญาติสายตรง ไม่ใช่ "โควตาต่อปี" แต่เป็น
--      "สิทธิ์ตามเหตุการณ์" (event-based) บางประเภทจำกัดจำนวนครั้งตลอดการทำงาน (บวช/แต่งงาน
--      ได้คนละ 1 ครั้ง) บางประเภทต้องมีอายุงานขั้นต่ำก่อน (บวช/ภรรยาคลอด ต้องอายุงาน 1 ปีขึ้นไป)
--
-- แนวทาง: เก็บ "ตัวเลขนโยบาย" (เพดานวัน, ขั้นบันไดอายุงาน, ตารางปีแรก) เป็นข้อมูลในตาราง
-- ไม่ hardcode ในโค้ด เพื่อให้แอดมินแก้ไขได้เองในอนาคตถ้านโยบายเปลี่ยน (ตอบคำถามผู้ใช้ที่ถามว่า
-- "แอดมินแก้ไขจำนวนวันลาสูงสุดได้ไหม" - ตอนนี้ยังไม่มี UI แก้ แต่โครงสร้างข้อมูลรองรับแล้ว
-- เหมือน leave_types เดิมที่ RLS เปิดให้ admin แก้ได้แต่ยังไม่มีหน้าจอ)
--
-- หมายเหตุสำคัญ (deferred - ไม่ทำในไฟล์นี้ เพราะต้องพึ่ง Payroll Engine ที่ยังไม่มี):
--   - การจ่ายเงินชดเชยวันลาพักร้อนสะสมเกิน 14 วัน (ต้องคำนวณจากเงินเดือนจริง)
--   - ผลกระทบของแต่ละประเภทลาต่อเบี้ยขยัน/โบนัส (เป็นการคำนวณ payroll ไม่ใช่ ESS)
--   - เงินช่วยเหลือฌาปนกิจ/ภัยพิบัติ (เป็นคนละฟีเจอร์กับ "ใบลา" - เป็นคำขอเงินช่วยเหลือ)
--
-- ตารางที่ 1 (ปีแรก) มีช่องว่างในเอกสารต้นฉบับ (16-18 ส.ค. ไม่ได้ระบุ) - ผู้ใช้ยืนยันแล้วว่า
-- เป็น typo ให้ถือว่าต่อเนื่องจากช่วง 1 ก.ค.-15 ส.ค. คือ 16 ส.ค.-15 ธ.ค. = 0 วัน (ไม่มีช่องว่าง)
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS
-- รันบน Staging ก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: ขยาย leave_types
-- =====================================================

ALTER TABLE public.leave_types
  ADD COLUMN IF NOT EXISTS entitlement_model text NOT NULL DEFAULT 'annual_quota', -- 'annual_quota' | 'event_based'
  ADD COLUMN IF NOT EXISTS leave_year_cycle text NOT NULL DEFAULT 'calendar', -- 'calendar' (ม.ค.-ธ.ค.) | 'company_fiscal' (16 ธ.ค.-16 ธ.ค. เฉพาะลาพักร้อน)
  ADD COLUMN IF NOT EXISTS min_tenure_days integer, -- null = ไม่มีเงื่อนไขอายุงานขั้นต่ำ
  ADD COLUMN IF NOT EXISTS max_occurrences_lifetime integer, -- null = ไม่จำกัดจำนวนครั้งตลอดการทำงาน (เช่น งานศพ/คลอดบุตร), 1 = ได้ครั้งเดียว (บวช/แต่งงาน)
  ADD COLUMN IF NOT EXISTS max_days_per_occurrence numeric; -- ใช้กับ event_based แทน max_days_per_year (เช่น งานศพ 5 วัน/ครั้ง)

-- ปรับข้อมูลเดิมให้ตรงกับนโยบายจริง
UPDATE public.leave_types SET entitlement_model = 'annual_quota', leave_year_cycle = 'company_fiscal'
  WHERE code = 'annual' AND company_id = 'comp_kc_clean';

UPDATE public.leave_types SET entitlement_model = 'event_based', min_tenure_days = 365, max_occurrences_lifetime = 1,
    max_days_per_occurrence = 15, max_days_per_year = NULL
  WHERE code = 'ordination' AND company_id = 'comp_kc_clean';

UPDATE public.leave_types SET entitlement_model = 'event_based', max_days_per_occurrence = 98, max_days_per_year = NULL
  WHERE code = 'maternity' AND company_id = 'comp_kc_clean';

-- sick/personal/unpaid: ไม่ระบุรอบปีพิเศษในเอกสาร คงเป็น annual_quota + calendar ตามเดิม

-- เพิ่มประเภทลาใหม่ที่ขาดหายไป (ระเบียบที่ 8, 10, 11 ในเอกสารสวัสดิการ)
INSERT INTO public.leave_types (company_id, code, name_th, is_paid, entitlement_model, max_days_per_occurrence, requires_attachment)
VALUES
  ('comp_kc_clean', 'funeral', 'ลางานศพญาติสายตรง', true, 'event_based', 5, true),
  ('comp_kc_clean', 'wedding', 'ลาแต่งงาน', true, 'event_based', 3, true),
  ('comp_kc_clean', 'paternity', 'ลากรณีภรรยาคลอดบุตร', true, 'event_based', 3, true)
ON CONFLICT (company_id, code) DO NOTHING;

-- ลาแต่งงาน/ลากรณีภรรยาคลอดบุตร ต้องอายุงานอย่างน้อย 1 ปีถึงจะใช้สิทธิ์ได้ (ระเบียบที่ 11)
-- ลาแต่งงานได้ครั้งเดียวตลอดการทำงาน ("ได้คนละ 1 ครั้ง" ตามระเบียบที่ 10)
UPDATE public.leave_types SET min_tenure_days = 365 WHERE code = 'paternity' AND company_id = 'comp_kc_clean';
UPDATE public.leave_types SET max_occurrences_lifetime = 1 WHERE code = 'wedding' AND company_id = 'comp_kc_clean';

COMMIT;

-- =====================================================
-- PART 2: ตารางขั้นบันไดลาพักร้อนตามอายุงาน (ระเบียบที่ 7 ตารางที่ 2)
-- และตารางสัดส่วนปีแรก (ตารางที่ 1) - เก็บเป็นข้อมูล ไม่ hardcode ในโค้ด
-- เพื่อให้แอดมินแก้ไขได้เองในอนาคต (ตอบคำถามผู้ใช้ที่ถามเรื่องนี้โดยตรง)
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.annual_leave_tenure_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'comp_kc_clean',
  min_work_year integer NOT NULL, -- ปีของการทำงานเริ่มต้นของช่วงนี้ (เช่น 2, 5, 8, 11)
  max_work_year integer, -- null = ไม่มีเพดานบน (ปีที่ 11 ขึ้นไป)
  entitled_days numeric NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT annual_leave_tenure_tiers_unique UNIQUE (company_id, min_work_year)
);
CREATE INDEX IF NOT EXISTS idx_annual_tenure_tiers_company ON public.annual_leave_tenure_tiers (company_id);

INSERT INTO public.annual_leave_tenure_tiers (company_id, min_work_year, max_work_year, entitled_days)
VALUES
  ('comp_kc_clean', 2, 4, 6),
  ('comp_kc_clean', 5, 7, 8),
  ('comp_kc_clean', 8, 10, 11),
  ('comp_kc_clean', 11, NULL, 14)
ON CONFLICT (company_id, min_work_year) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.annual_leave_first_year_proration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'comp_kc_clean',
  start_month integer NOT NULL, -- เดือนเริ่มงาน (1-12) ของขอบเขตล่างของช่วง
  start_day integer NOT NULL, -- วันที่เริ่มงาน (1-31) ของขอบเขตล่างของช่วง
  end_month integer NOT NULL,
  end_day integer NOT NULL,
  entitled_days numeric NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT annual_leave_first_year_proration_unique UNIQUE (company_id, start_month, start_day)
);
CREATE INDEX IF NOT EXISTS idx_annual_first_year_company ON public.annual_leave_first_year_proration (company_id);

-- ตารางที่ 1: ช่วง 16 ส.ค.-18 ส.ค. ที่เป็นช่องว่างในเอกสารต้นฉบับ ถือเป็น typo ตามที่ผู้ใช้ยืนยัน
-- แก้ให้ต่อเนื่องจากช่วง 1 ก.ค.-15 ส.ค. คือรวมเป็น 16 ส.ค.-15 ธ.ค. = 0 วัน
INSERT INTO public.annual_leave_first_year_proration (company_id, start_month, start_day, end_month, end_day, entitled_days)
VALUES
  ('comp_kc_clean', 12, 16, 12, 31, 6),
  ('comp_kc_clean', 1, 1, 2, 29, 5),
  ('comp_kc_clean', 3, 1, 4, 30, 4),
  ('comp_kc_clean', 5, 1, 6, 30, 3),
  ('comp_kc_clean', 7, 1, 8, 15, 2),
  ('comp_kc_clean', 8, 16, 12, 15, 0)
ON CONFLICT (company_id, start_month, start_day) DO NOTHING;

COMMIT;

-- =====================================================
-- PART 3: RLS สำหรับตารางใหม่ + เพิ่มเงื่อนไข tenure/lifetime-limit ใน leave_requests INSERT
-- =====================================================

BEGIN;

-- 3.1 annual_leave_tenure_tiers / annual_leave_first_year_proration: อ่านได้ทุกคนใน company
-- (เป็น master data ไม่ sensitive จำเป็นต้องให้ ESS อ่านไปคำนวณยอดลาคงเหลือของตัวเอง)
ALTER TABLE public.annual_leave_tenure_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS annual_leave_tenure_tiers_select_all ON public.annual_leave_tenure_tiers;
CREATE POLICY annual_leave_tenure_tiers_select_all ON public.annual_leave_tenure_tiers
  FOR SELECT USING (company_id = public.get_user_company());
DROP POLICY IF EXISTS annual_leave_tenure_tiers_manage_admin ON public.annual_leave_tenure_tiers;
CREATE POLICY annual_leave_tenure_tiers_manage_admin ON public.annual_leave_tenure_tiers
  FOR ALL
  USING (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company())
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company());

ALTER TABLE public.annual_leave_first_year_proration ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS annual_leave_first_year_proration_select_all ON public.annual_leave_first_year_proration;
CREATE POLICY annual_leave_first_year_proration_select_all ON public.annual_leave_first_year_proration
  FOR SELECT USING (company_id = public.get_user_company());
DROP POLICY IF EXISTS annual_leave_first_year_proration_manage_admin ON public.annual_leave_first_year_proration;
CREATE POLICY annual_leave_first_year_proration_manage_admin ON public.annual_leave_first_year_proration
  FOR ALL
  USING (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company())
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company());

-- 3.2 leave_requests INSERT: เพิ่มเงื่อนไข "ผ่านเกณฑ์อายุงานขั้นต่ำ" และ "ยังไม่ใช้สิทธิ์ครบจำนวนครั้งตลอดการทำงาน"
-- ของประเภทลานั้นๆ (บังคับจริงที่ RLS ไม่ใช่แค่ฝั่ง UI - เหมือน pattern advance_payments eligibility)
DROP POLICY IF EXISTS leave_requests_insert_employee ON public.leave_requests;
CREATE POLICY leave_requests_insert_employee ON public.leave_requests
  FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company()
    AND (
      public.get_user_role() = 'admin'
      OR (
        public.get_user_role() = 'employee'
        AND emp_id = (SELECT emp_id FROM public.user_profiles WHERE auth_uid = auth.uid())
        AND employee_id = (SELECT employee_id FROM public.user_profiles WHERE auth_uid = auth.uid())
        AND status = 'pending'
        -- เงื่อนไขอายุงานขั้นต่ำ (min_tenure_days) ของประเภทลานี้ ถ้ามีกำหนดไว้
        AND (
          NOT EXISTS (
            SELECT 1 FROM public.leave_types lt WHERE lt.id = leave_type_id AND lt.min_tenure_days IS NOT NULL
          )
          OR EXISTS (
            SELECT 1 FROM public.leave_types lt
            JOIN public.employees e ON e.id = leave_requests.employee_id
            WHERE lt.id = leave_requests.leave_type_id
            AND e.available_start_date IS NOT NULL
            AND (CURRENT_DATE - e.available_start_date) >= lt.min_tenure_days
          )
        )
        -- เงื่อนไขจำนวนครั้งตลอดการทำงาน (max_occurrences_lifetime) ของประเภทลานี้ ถ้ามีกำหนดไว้
        AND (
          NOT EXISTS (
            SELECT 1 FROM public.leave_types lt WHERE lt.id = leave_type_id AND lt.max_occurrences_lifetime IS NOT NULL
          )
          OR (
            SELECT COUNT(*) FROM public.leave_requests lr2
            WHERE lr2.employee_id = leave_requests.employee_id
            AND lr2.leave_type_id = leave_requests.leave_type_id
            AND lr2.status IN ('pending', 'approved')
          ) < (SELECT lt.max_occurrences_lifetime FROM public.leave_types lt WHERE lt.id = leave_requests.leave_type_id)
        )
      )
    )
  );

COMMIT;

-- =====================================================
-- PART 4: Storage policy - อนุญาตให้พนักงาน/หัวหน้างานอัปโหลดไฟล์แนบประกอบการลา
-- (ใบมรณบัตร/การ์ดเชิญแต่งงาน/สูติบัตร) ลง bucket announcement_attachments เดิม ภายใต้
-- prefix "leave_requests/" เท่านั้น (ไม่ปะปนกับไฟล์แนบประกาศที่จำกัดเฉพาะ admin/payroll)
--
-- ใช้ bucket เดิมแทนการสร้าง bucket ใหม่เพื่อลดความซับซ้อน bucket นี้เป็น public-read
-- (เหมือน recruitment_files ที่มีอยู่ก่อนแล้วในระบบ) - ยอมรับความเสี่ยงระดับเดียวกับที่ระบบ
-- ใช้อยู่แล้วทั่วทั้งระบบ (URL คาดเดายากเพราะมี timestamp/uuid ในชื่อไฟล์ แต่ไม่ใช่ private storage
-- ที่ต้องใช้ signed URL) - หากต้องการยกระดับความเป็นส่วนตัวของเอกสารเหล่านี้ในอนาคต
-- (เช่น ใบรับรองแพทย์) ควรแยกเป็น private bucket + signed URL ซึ่งเป็นงานเพิ่มเติมที่ยังไม่ทำตอนนี้
-- =====================================================

BEGIN;

DROP POLICY IF EXISTS announcement_attachments_employee_insert_leave ON storage.objects;
CREATE POLICY announcement_attachments_employee_insert_leave ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'announcement_attachments'
    AND public.get_user_role() IN ('employee', 'supervisor')
    AND (storage.foldername(name))[1] = 'leave_requests'
  );

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate เพื่อ sanity check)
-- =====================================================
-- SELECT code, entitlement_model, leave_year_cycle, min_tenure_days, max_occurrences_lifetime, max_days_per_occurrence, max_days_per_year FROM public.leave_types ORDER BY code;
-- SELECT * FROM public.annual_leave_tenure_tiers ORDER BY min_work_year;
-- SELECT * FROM public.annual_leave_first_year_proration ORDER BY start_month, start_day;
