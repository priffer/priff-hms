-- Migration 39: Add company_id to public.clients
--
-- company_id เป็น text ไม่มี FK เพราะยังไม่มีตาราง companies แยก
-- ถ้าระบบขยายรองรับหลายบริษัทในอนาคต ต้องกลับมา design FK ตรงนี้ใหม่
-- Idempotent: Staging may already have the column from an earlier manual apply.

BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS company_id text DEFAULT 'comp_kc_clean'::text;

UPDATE public.clients
  SET company_id = 'comp_kc_clean'
  WHERE company_id IS NULL;

ALTER TABLE public.clients
  ALTER COLUMN company_id SET DEFAULT 'comp_kc_clean'::text;

ALTER TABLE public.clients
  ALTER COLUMN company_id SET NOT NULL;

COMMIT;
