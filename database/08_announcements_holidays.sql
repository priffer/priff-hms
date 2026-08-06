-- =====================================================
-- database/08_announcements_holidays.sql
-- ESS Redesign: Company Announcements + Holiday Calendar (company & per-client)
--
-- บริบท: อนุมัติจากผู้ใช้งานแล้ว (turn ที่ 2 ของ session นี้) ให้เพิ่ม schema ใหม่
-- 3 ตารางเพื่อรองรับ:
--   1) announcements: ประกาศบริษัท/ระเบียบ/สวัสดิการ ที่ Admin อัปโหลดให้พนักงานเห็นใน ESS
--   2) company_holidays: ปฏิทินวันหยุดนักขัตฤกษ์ระดับบริษัท (seed จากไฟล์ Excel
--      ปฏิทิน 2026.xlsx / ปฏิทิน 2027.xlsx ที่ผู้ใช้แนบมา - เฉพาะวันที่มี fill สีเขียว
--      "ช่องวันหยุดเทศกาล" ตาม legend ในไฟล์ ไม่รวมวันหยุดประจำสัปดาห์/วัน WFH)
--   3) client_holidays: วันหยุดเฉพาะไซต์ลูกค้า (client_id FK) - สำคัญเพราะ KC Clean Trade
--      เป็นธุรกิจ outsource พนักงานไปประจำไซต์ลูกค้า วันหยุดจึงอาจไม่ตรงปฏิทินบริษัท
--      และเป็น input ตรงของการคำนวณ OT3 (วันหยุดนักขัตฤกษ์) ใน Payroll Engine ในอนาคต
--      -- ถ้าไม่มี override เฉพาะไซต์ ให้ fallback ไปใช้ company_holidays (จัดการที่ query/engine
--      -- ชั้น application ไม่ใช่ที่ schema)
--
-- Convention เดิม: uuid pk, company_id text, timestamptz UTC, RLS ผ่าน
-- get_user_role()/get_user_company() ที่มีอยู่แล้ว (01_payroll_migration_v2.sql PART 3)
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS / ON CONFLICT DO NOTHING
-- รันบน Staging เท่านั้นก่อน แล้วตรวจสอบผลลัพธ์ก่อนพิจารณา Production
-- =====================================================

-- =====================================================
-- PART 1: TABLES
-- =====================================================

BEGIN;

-- 1.1 announcements
CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'comp_kc_clean',
  title text NOT NULL,
  body text NOT NULL,
  category text NOT NULL DEFAULT 'general', -- general, policy, benefit, safety
  attachment_url text,
  target_roles jsonb, -- null หรือ [] = ทุก role เห็น, เช่น ["employee","supervisor"]
  is_pinned boolean NOT NULL DEFAULT false,
  published_at timestamp with time zone, -- null = draft ยังไม่เผยแพร่
  expires_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS idx_announcements_company_published ON public.announcements (company_id, published_at);
CREATE INDEX IF NOT EXISTS gin_announcements_target_roles ON public.announcements USING GIN (target_roles);

-- 1.2 company_holidays
CREATE TABLE IF NOT EXISTS public.company_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'comp_kc_clean',
  holiday_date date NOT NULL,
  name_th text NOT NULL,
  holiday_type text NOT NULL DEFAULT 'public', -- public, company_special, substitution
  source text, -- เช่นชื่อไฟล์ Excel ที่นำเข้า เพื่อ traceability
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT company_holidays_unique UNIQUE (company_id, holiday_date)
);
CREATE INDEX IF NOT EXISTS idx_company_holidays_date ON public.company_holidays (company_id, holiday_date);

-- 1.3 client_holidays (override เฉพาะไซต์ลูกค้า - ใช้ประกอบการคำนวณ OT3 ในอนาคต)
CREATE TABLE IF NOT EXISTS public.client_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'comp_kc_clean',
  client_id uuid NOT NULL REFERENCES public.clients(id),
  holiday_date date NOT NULL,
  name_th text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT client_holidays_unique UNIQUE (client_id, holiday_date)
);
CREATE INDEX IF NOT EXISTS idx_client_holidays_client_date ON public.client_holidays (client_id, holiday_date);
CREATE INDEX IF NOT EXISTS idx_client_holidays_company ON public.client_holidays (company_id);

COMMIT;

-- =====================================================
-- PART 2: SEED company_holidays จากไฟล์ Excel ที่ผู้ใช้แนบมา
-- (เฉพาะวันที่ fill สีเขียว "ช่องวันหยุดเทศกาล" ตาม legend ในไฟล์ - ไม่รวมวันหยุด
-- ประจำสัปดาห์สีแดง และวัน Work From Home สีส้มซึ่งไม่ใช่วันหยุดจริง)
-- ปี 2027 ในไฟล์ต้นฉบับมีเฉพาะเดือนมกราคมที่ระบุไว้ชัดเจน ณ วันที่นำเข้าข้อมูล
-- (ปีถัดไปยังไม่ได้ประกาศครบทั้งปี) - เพิ่มเติมได้ภายหลังผ่านหน้า Admin
-- =====================================================

BEGIN;

INSERT INTO public.company_holidays (company_id, holiday_date, name_th, holiday_type, source)
VALUES
  ('comp_kc_clean', '2026-01-01', 'วันขึ้นปีใหม่', 'public', 'ปฏิทิน 2026.xlsx'),
  ('comp_kc_clean', '2026-01-02', 'วันหยุดชดเชยวันขึ้นปีใหม่', 'substitution', 'ปฏิทิน 2026.xlsx'),
  ('comp_kc_clean', '2026-01-03', 'วันหยุดชดเชยวันขึ้นปีใหม่', 'substitution', 'ปฏิทิน 2026.xlsx'),
  ('comp_kc_clean', '2026-04-13', 'วันสงกรานต์', 'public', 'ปฏิทิน 2026.xlsx'),
  ('comp_kc_clean', '2026-04-14', 'วันสงกรานต์', 'public', 'ปฏิทิน 2026.xlsx'),
  ('comp_kc_clean', '2026-04-15', 'วันสงกรานต์', 'public', 'ปฏิทิน 2026.xlsx'),
  ('comp_kc_clean', '2026-04-16', 'วันหยุดพิเศษต่อเนื่องสงกรานต์ (บริษัทกำหนด)', 'company_special', 'ปฏิทิน 2026.xlsx'),
  ('comp_kc_clean', '2026-04-17', 'วันหยุดพิเศษต่อเนื่องสงกรานต์ (บริษัทกำหนด)', 'company_special', 'ปฏิทิน 2026.xlsx'),
  ('comp_kc_clean', '2026-04-18', 'วันหยุดพิเศษต่อเนื่องสงกรานต์ (บริษัทกำหนด)', 'company_special', 'ปฏิทิน 2026.xlsx'),
  ('comp_kc_clean', '2026-05-01', 'วันแรงงานแห่งชาติ', 'public', 'ปฏิทิน 2026.xlsx'),
  ('comp_kc_clean', '2026-06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี', 'public', 'ปฏิทิน 2026.xlsx'),
  ('comp_kc_clean', '2026-07-28', 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว', 'public', 'ปฏิทิน 2026.xlsx'),
  ('comp_kc_clean', '2026-12-28', 'วันหยุดพิเศษส่งท้ายปี (บริษัทกำหนด)', 'company_special', 'ปฏิทิน 2026.xlsx'),
  ('comp_kc_clean', '2026-12-29', 'วันหยุดพิเศษส่งท้ายปี (บริษัทกำหนด)', 'company_special', 'ปฏิทิน 2026.xlsx'),
  ('comp_kc_clean', '2026-12-30', 'วันหยุดพิเศษส่งท้ายปี (บริษัทกำหนด)', 'company_special', 'ปฏิทิน 2026.xlsx'),
  ('comp_kc_clean', '2026-12-31', 'วันสิ้นปี', 'public', 'ปฏิทิน 2026.xlsx'),
  ('comp_kc_clean', '2027-01-01', 'วันขึ้นปีใหม่', 'public', 'ปฏิทิน 2027.xlsx'),
  ('comp_kc_clean', '2027-01-02', 'วันหยุดชดเชยวันขึ้นปีใหม่', 'substitution', 'ปฏิทิน 2027.xlsx')
ON CONFLICT (company_id, holiday_date) DO NOTHING;

COMMIT;

-- =====================================================
-- PART 3: ENABLE RLS & POLICIES
-- =====================================================

BEGIN;

-- 3.1 announcements: ทุกคนใน company เห็นเฉพาะประกาศที่เผยแพร่แล้ว/ยังไม่หมดอายุ/
-- ตรงกับ target_roles ของตน; admin เห็นทุกอย่างรวม draft เพื่อจัดการ; payroll จัดการได้เหมือน admin
DROP POLICY IF EXISTS announcements_select_published ON public.announcements;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY announcements_select_published ON public.announcements
  FOR SELECT
  USING (
    company_id = public.get_user_company()
    AND (
      public.get_user_role() IN ('admin', 'payroll')
      OR (
        published_at IS NOT NULL AND published_at <= now()
        AND (expires_at IS NULL OR expires_at > now())
        AND (
          target_roles IS NULL
          OR jsonb_array_length(target_roles) = 0
          OR target_roles ? public.get_user_role()
        )
      )
    )
  );

DROP POLICY IF EXISTS announcements_manage_admin_payroll ON public.announcements;
CREATE POLICY announcements_manage_admin_payroll ON public.announcements
  FOR ALL
  USING (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company())
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company());

-- 3.2 company_holidays: ทุกคนใน company อ่านได้ (ต้องรู้วันหยุดของตัวเอง), จัดการ admin/payroll
ALTER TABLE public.company_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_holidays_select_all ON public.company_holidays;
CREATE POLICY company_holidays_select_all ON public.company_holidays
  FOR SELECT
  USING (company_id = public.get_user_company());

DROP POLICY IF EXISTS company_holidays_manage_admin_payroll ON public.company_holidays;
CREATE POLICY company_holidays_manage_admin_payroll ON public.company_holidays
  FOR ALL
  USING (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company())
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company());

-- 3.3 client_holidays: ทุกคนใน company อ่านได้ (พนักงานที่ประจำไซต์นั้นต้องรู้),
-- supervisor ที่ดูแลไซต์นั้นอ่านได้เช่นกัน (ครอบคลุมอยู่แล้วด้วยเงื่อนไข company_id),
-- จัดการ admin/payroll เท่านั้น
ALTER TABLE public.client_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_holidays_select_all ON public.client_holidays;
CREATE POLICY client_holidays_select_all ON public.client_holidays
  FOR SELECT
  USING (company_id = public.get_user_company());

DROP POLICY IF EXISTS client_holidays_manage_admin_payroll ON public.client_holidays;
CREATE POLICY client_holidays_manage_admin_payroll ON public.client_holidays
  FOR ALL
  USING (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company())
  WITH CHECK (public.get_user_role() IN ('admin', 'payroll') AND company_id = public.get_user_company());

COMMIT;

-- =====================================================
-- Verification queries (รันแยกด้วยมือหลัง migrate เพื่อ sanity check)
-- =====================================================
-- SELECT * FROM public.company_holidays ORDER BY holiday_date;
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN ('announcements','company_holidays','client_holidays');
