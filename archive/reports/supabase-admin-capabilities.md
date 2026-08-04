# Supabase Admin API Capability Validation Report

**PHASE 12A — Supabase Admin Capability Validation**
**วันที่ตรวจสอบ:** 2026-08-04
**Environment:** Staging (Supabase Project Ref: `hcyibcqojsyldiyzperr`)
**สถานะ:** ตรวจสอบสิทธิ์เท่านั้น (Read-only / Non-destructive probes) — ไม่มีการสร้าง/แก้ไข/ลบผู้ใช้จริง

---

## 1. วัตถุประสงค์

ยืนยันว่า `SUPABASE_SERVICE_ROLE_KEY` ที่ถูกเพิ่มลงใน `.env` สามารถเรียกใช้ Supabase Auth Admin API (GoTrue Admin Endpoints) ได้จริงหรือไม่ ก่อนที่จะอนุญาตให้เข้าสู่ขั้นตอน Authenticated RLS Testing (PHASE 12) แบบเต็มรูปแบบ

---

## 2. วิธีการตรวจสอบ (Non-Destructive Probe Method)

เพื่อให้เป็นไปตามข้อห้าม **"ห้ามสร้าง User จริง / ห้ามแก้ไขข้อมูลจริง"** สคริปต์ตรวจสอบ (`scripts/check_supabase_admin_api.js`) ใช้เทคนิคดังนี้:

| ความสามารถ | วิธีทดสอบแบบปลอดภัย | เกณฑ์ยืนยันสิทธิ์ |
|---|---|---|
| List Auth Users | เรียก `GET /auth/v1/admin/users` จริง (read-only ไม่มีผลข้างเคียง) | HTTP 200 + คืนรายการผู้ใช้ |
| Create Auth Users | ส่ง payload ที่ตั้งใจให้ผิด format อีเมล เพื่อให้ GoTrue ปฏิเสธที่ชั้น validation **ก่อน** จะสร้างผู้ใช้จริง | HTTP 400/422 (`validation_failed`) = มีสิทธิ์แต่ข้อมูลไม่ผ่าน validation (ไม่ได้สร้างผู้ใช้จริง)<br>HTTP 401/403 = ไม่มีสิทธิ์ |
| Update Auth Users | เรียก `PUT /auth/v1/admin/users/<uuid สุ่มที่ไม่มีอยู่จริง>` | HTTP 404 (`user_not_found`) = มีสิทธิ์ผ่านชั้น Authorization แล้วแต่หา target ไม่เจอ (ปลอดภัย ไม่กระทบข้อมูลจริง)<br>HTTP 401/403 = ไม่มีสิทธิ์ |
| Delete Auth Users | เรียก `DELETE /auth/v1/admin/users/<uuid สุ่มที่ไม่มีอยู่จริง>` | เกณฑ์เดียวกับ Update |

> หมายเหตุ: การใช้ UUID `00000000-0000-0000-0000-000000000000` (ที่ไม่มีอยู่จริงในระบบ) ทำให้มั่นใจได้ว่า Update/Delete probe จะไม่กระทบบัญชีผู้ใช้จริงใดๆ

---

## 3. ผลการตรวจสอบ

| ความสามารถ | HTTP Status | ผลลัพธ์ | สถานะ |
|---|---|---|---|
| **List Auth Users** | 200 | คืนรายชื่อผู้ใช้ได้สำเร็จ | ✅ **CONFIRMED** |
| **Create Auth Users** | 400 | `validation_failed: Unable to validate email address: invalid format` (ไม่ได้สร้างผู้ใช้จริง เพราะ payload จงใจให้ผิด format) | ✅ **CONFIRMED** (มีสิทธิ์สร้าง — ผ่านชั้น Authorization ก่อนถึงชั้น Validation) |
| **Update Auth Users** | 404 | `user_not_found` (เป้าหมายเป็น UUID ปลอมที่ไม่มีอยู่จริง) | ✅ **CONFIRMED** |
| **Delete Auth Users** | 404 | `user_not_found` (เป้าหมายเป็น UUID ปลอมที่ไม่มีอยู่จริง) | ✅ **CONFIRMED** |

**สรุป:** `SUPABASE_SERVICE_ROLE_KEY` (รูปแบบใหม่ `sb_secret_...`) มีสิทธิ์ **Full Admin Access** ต่อ Supabase Auth (GoTrue) ครบทั้ง 4 ความสามารถ — Agent สามารถบริหารจัดการ Test Accounts ได้ด้วยตนเองในขั้นตอนถัดไป (เมื่อได้รับอนุญาต)

Raw output ถูกบันทึกไว้ที่ `scripts/supabase-admin-capability-result.json` (สำหรับ audit trail)

---

## 4. ⚠️ ข้อค้นพบสำคัญที่ต้องแจ้ง CEO/Architect ก่อนดำเนินการต่อ

ระหว่างตรวจสอบ (List Auth Users แบบ read-only) พบว่า **มีผู้ใช้จริงอยู่ในระบบ Auth ของโปรเจกต์นี้แล้ว 1 บัญชี**:

| Auth UID | Email | Created At |
|---|---|---|
| `bc782bb8-5231-4160-be7f-d26e66a9a623` | `admin@kccleantrade.com` | 2026-05-13 |

- บัญชีนี้**ไม่ตรง**กับ `auth_uid` ใดๆ ที่ผูกไว้ใน `user_profiles` ของ `company_id = 'comp_kc_clean'` (ซึ่งทั้งหมดยังเป็นค่า placeholder `gen_random_uuid()`) — จึงไม่กระทบ Test Accounts ที่วางแผนไว้
- **แต่** อีเมล `admin@kccleantrade.com` มีลักษณะเป็นบัญชีจริงของบริษัท (ไม่ใช่ `@comp.kc` หรือ `*.internal` ที่ใช้ในชุดทดสอบ) → เป็นไปได้ว่า **Supabase Project (`hcyibcqojsyldiyzperr`) นี้อาจไม่ใช่ Staging Project ที่แยกออกมาต่างหาก แต่อาจเป็น Project เดียวกับที่ใช้งานจริง (Production/Shared)**
- **คำแนะนำ (ต้องได้รับการยืนยันจากมนุษย์ก่อนสร้าง Test Users จริง):**
  1. ยืนยันกับทีมว่า Supabase Project ref `hcyibcqojsyldiyzperr` เป็น Staging แยกต่างหาก หรือเป็น Project เดียวกับ Production
  2. หากเป็น Project เดียวกับ Production **ห้ามสร้าง/ลบ Auth Users ทดสอบใดๆ ในโปรเจกต์นี้โดยเด็ดขาด** ต้องขอ Staging Project แยกต่างหาก หรือใช้ Local Supabase (Docker) แทน
  3. ห้าม Agent แตะต้องบัญชี `admin@kccleantrade.com` นี้ไม่ว่ากรณีใดๆ (ไม่ Update ไม่ Delete)

---

## 5. แผน Fully Automated Authenticated RLS Testing (เสนอ — รอการอนุมัติ)

เนื่องจาก Admin API ใช้งานได้ครบทุกความสามารถ จึงสามารถออกแบบการทดสอบ Authenticated RLS แบบอัตโนมัติเต็มรูปแบบได้ 2 แนวทาง:

### แนวทาง A — สร้าง Real Auth Users จริงผ่าน Admin API (Full E2E)
1. **Cleanup ข้อมูลซ้ำก่อน** — ลบ `user_profiles`/`employees`/`clients` ที่ซ้ำ (พบใน Phase 12: 3x ต่อ role) ให้เหลือ record เดียวต่อ role (ต้องขออนุมัติแยก เพราะเป็นการแก้ไขข้อมูล)
2. Agent เรียก `POST /auth/v1/admin/users` สร้างบัญชีทดสอบ 4 บัญชี (admin/payroll/supervisor/employee) ด้วยอีเมล synthetic เช่น `qa-admin@kc-clean.internal` พร้อม `email_confirm: true` และรหัสผ่านสุ่มปลอดภัย (เก็บชั่วคราวในหน่วยความจำ/ไฟล์ local ที่ไม่ commit เท่านั้น)
3. `UPDATE public.user_profiles SET auth_uid = '<uid ใหม่>' WHERE id = '<user_profile_id>'`
4. Sign-in จริงผ่าน `POST /auth/v1/token?grant_type=password` (ต้องใช้ **Anon/Publishable Key** — ปัจจุบันยังไม่มีใน `.env`, เป็น **Blocker**) เพื่อรับ JWT จริง
5. ใช้ JWT เรียก REST ผ่าน PostgREST (`/rest/v1/...`) หรือ pass เข้า `supabase-js` client เพื่อรันชุดคำสั่งใน `docs/authenticated-rls-test-plan.md` ต่อ role
6. เปรียบเทียบผลลัพธ์กับ Expected Result แล้วบันทึกลง `docs/authenticated-rls-test-report.md`
7. Cleanup: ใช้ Delete capability ที่ยืนยันแล้ว ลบบัญชีทดสอบเมื่อจบการทดสอบ (ตามนโยบาย Staging)

**Blocker ของแนวทาง A:** ต้องมี `SUPABASE_ANON_KEY` (Publishable Key) เพิ่มเติมใน `.env` เพื่อเรียก Password Grant Token Endpoint — Service Role Key เพียงอย่างเดียวไม่สามารถ Login แทนผู้ใช้ได้ (ตั้งใจออกแบบมาเช่นนั้นเพื่อความปลอดภัย)

### แนวทาง B — จำลอง Authenticated Context ผ่าน SQL Session Variables (ไม่ต้องใช้ Anon Key)
Supabase's PostgREST/GoTrue กำหนดค่า `auth.uid()` จากการอ่าน Postgres session setting `request.jwt.claims`. Agent สามารถจำลอง Authenticated Session ได้โดยตรงผ่าน SQL (รันในธุรกรรมเดียว แล้ว ROLLBACK เพื่อไม่ทิ้งผลข้างเคียง):

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<auth_uid ของ user_profiles ที่ต้องการจำลอง>","role":"authenticated"}';
-- รันคำสั่งทดสอบจาก database/03_test_rls_policies.sql ที่นี่ ต่อ role
ROLLBACK; -- ไม่ commit การเปลี่ยนแปลงใดๆ ที่เกิดจากการทดสอบ
```

**ข้อดี:** ไม่ต้องสร้างบัญชีจริง ไม่ต้องมี Anon Key ไม่ทิ้งข้อมูลตกค้าง (ROLLBACK ทุกครั้ง) และยืนยันพฤติกรรมของ RLS Policy ภายใต้ `auth.uid()` จริงได้แม่นยำเทียบเท่าแนวทาง A
**ข้อจำกัด:** เป็นการจำลอง JWT Claims ด้วยมือ (ไม่ผ่าน GoTrue Token Issuance จริง) จึงไม่ครอบคลุมการทดสอบ Login Flow/Session Expiry/Token Refresh ของหน้า Frontend จริง — เหมาะสำหรับยืนยันความถูกต้องของ RLS Policy Logic เท่านั้น ไม่ใช่ End-to-End UX Testing

### คำแนะนำ
ใช้ **แนวทาง B ก่อน** เพื่อยืนยัน RLS Policy Logic ทั้งหมดแบบอัตโนมัติ 100% โดยไม่ต้องรอ Anon Key หรือสร้างบัญชีจริง จากนั้นค่อยทำ **แนวทาง A** แบบจำกัดขอบเขต (Pilot 1-2 บัญชี) เพื่อยืนยัน Login Flow จริงบนหน้า `login.html` เมื่อได้รับอนุมัติและมี Anon Key พร้อมใช้งาน

---

## 6. Blockers ที่ต้องการการดำเนินการจากมนุษย์

| # | Blocker | รายละเอียด |
|---|---|---|
| 1 | ยืนยัน Project Scope | ต้องยืนยันว่า `hcyibcqojsyldiyzperr` เป็น Staging แยกต่างหากจาก Production หรือไม่ (พบบัญชีจริง `admin@kccleantrade.com`) |
| 2 | Anon/Publishable Key | ต้องการ `SUPABASE_ANON_KEY` ใน `.env` หากต้องการทดสอบแนวทาง A (Real Login) |
| 3 | อนุมัติสร้าง Test Users จริง | Phase นี้ห้ามสร้างผู้ใช้จริง — ต้องรออนุมัติแยกต่างหากก่อนรันแนวทาง A |
| 4 | Cleanup ข้อมูลซ้ำ | ต้องตัดสินใจว่าจะลบ record ซ้ำใน `user_profiles`/`employees`/`clients` อย่างไร ก่อน mapping auth_uid จริง (อ้างอิง Phase 12 finding) |

---

## 7. สรุป

- ✅ Supabase Admin API (GoTrue Admin Endpoints) ใช้งานได้ครบทั้ง 4 ความสามารถผ่าน `SUPABASE_SERVICE_ROLE_KEY`
- ⚠️ พบบัญชี Auth User จริง 1 รายการที่มีอยู่ก่อนแล้วในโปรเจกต์นี้ — ต้องยืนยัน Scope ของ Project ก่อนดำเนินการสร้าง Test Users เพิ่ม
- 📋 เสนอแผน 2 แนวทางสำหรับ Fully Automated Authenticated RLS Testing (แนวทาง B แนะนำให้เริ่มก่อน เพราะไม่ต้องรอ Anon Key และไม่มีความเสี่ยงต่อข้อมูล)
- 🚫 ไม่มีการสร้าง/แก้ไข/ลบ User จริง, ไม่มีการแก้ Schema/HTML/JavaScript ใดๆ ในขั้นตอนนี้ (ตามข้อห้ามของ Phase 12A)
