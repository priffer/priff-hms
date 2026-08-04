# Test Accounts — Staging (comp_kc_clean)

**สร้างเมื่อ:** 2026-08-04 (PHASE 13A)
**Environment:** Staging/UAT (Supabase Project `hcyibcqojsyldiyzperr`)
**สถานะ:** Active (สร้างผ่าน Supabase Auth Admin API, `email_confirm: true`)

⚠️ **คำเตือนความปลอดภัย:**
- ไฟล์นี้มี **รหัสผ่านจริง** ของบัญชีทดสอบ ห้าม commit ขึ้น public repository หรือแชร์ภายนอกทีม
- รหัสผ่านชุดนี้เป็น **Temporary Password สำหรับ UAT เท่านั้น** แนะนำให้หมุนเวียน (rotate) หลังจบรอบทดสอบ หรือลบบัญชีทิ้งเมื่อไม่ใช้งานแล้ว
- ห้ามนำอีเมล/รหัสผ่านชุดนี้ไปใช้กับ Production Environment โดยเด็ดขาด

## รายชื่อบัญชีทดสอบ

| Email | Role | Temporary Password | Auth UID | Mapped user_profiles.id |
|---|---|---|---|---|
| `qa-admin@kc-clean.internal` | admin | `Qa!kEmxp56k7h0B3G9x` | `8c8f6d40-97e2-421b-9327-0e1ad31517d0` | `4dd56722-bab8-4110-82f3-8f9d3829598b` |
| `qa-payroll@kc-clean.internal` | payroll | `Qa!l0yJOSZu72buPm9x` | `f8bb3931-82d8-449d-aa8d-06428a19b059` | `06d9ac95-ab45-4444-975e-c34cb9f20881` |
| `qa-supervisor@kc-clean.internal` | supervisor | `Qa!spOzVzYhbyA5VH9x` | `29d80d80-3c3d-4e70-b9da-972be18ec64f` | `05c73325-d9cb-4f14-bb1a-8debdc755879` |
| `qa-employee@kc-clean.internal` | employee | `Qa!Kh9P9jAyce7VUQ9x` | `ca85a3ef-d7f2-411c-888c-7ad03edd79f1` | `306bb203-1207-4c20-baab-f028cb2c9b14` |

## หมายเหตุสำคัญ

1. **การ Mapping**: แต่ละ role มี `user_profiles` ซ้ำอยู่ 3 รายการ (ปัญหาที่พบตั้งแต่ Phase 12 — ข้อมูลค้างจากการรัน Seed แบบไม่ Idempotent ในอดีต) เนื่องจาก `auth_uid` มีข้อกำหนด `UNIQUE` จึงเลือก mapping ไปยัง **1 profile ต่อ role** (เลือกแบบ deterministic ตาม `id` ที่น้อยที่สุด) — ไม่กระทบผลการทดสอบ RLS เพราะ Policy ทั้งหมดอ้างอิงจาก `emp_id`/`role`/`company_id` ที่เหมือนกันในทุกแถวซ้ำ
2. Profile ซ้ำอีก 2 รายการต่อ role **ยังคงมี `auth_uid` เป็นค่า `gen_random_uuid()` แบบเดิม** (ไม่ใช่บัญชีจริง) — ไม่สามารถ Login ได้ ปลอดภัย
3. บัญชีจริงที่มีอยู่ก่อนแล้วในระบบ (`admin@kccleantrade.com`, auth uid `bc782bb8-5231-4160-be7f-d26e66a9a623`) **ไม่ถูกแตะต้องใดๆ** ตลอดกระบวนการนี้

## การลบบัญชีทดสอบ (เมื่อจบการทดสอบ)

Agent ได้ยืนยันสิทธิ์ **Delete Auth User** ผ่าน Admin API แล้ว (ดู [docs/supabase-admin-capabilities.md](/C:/Users/kungk/Desktop/Saas-project/priff-hms.worktrees/priiff-hms-system-audit-report/docs/supabase-admin-capabilities.md)) สามารถลบบัญชีทดสอบทั้ง 4 นี้ได้ทันทีเมื่อได้รับคำสั่งอนุมัติจาก CEO/Architect
