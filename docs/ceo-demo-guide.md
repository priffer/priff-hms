# PRIFF-HMS — CEO Demo Guide (PHASE 13C)

**สถานะ:** 🔴 **ยังไม่ Deploy** — รอแก้ไขช่องโหว่ RLS Critical ตามที่ CEO ตัดสินใจไว้
**วันที่ตรวจสอบ:** 2026-08-04
**ผู้จัดทำ:** Agent (BUILD MODE / PHASE 13C — Deployment Readiness Review)

---

## 0. สรุปสำหรับ CEO (TL;DR)

CEO เลือกตัวเลือก **"รอแก้ช่องโหว่ RLS Critical ให้เสร็จก่อน แล้วค่อย Deploy"**
ดังนั้น **Agent ยังไม่ได้ Deploy ระบบขึ้น Vercel ในรอบนี้** ตามคำสั่งเดิมของ PHASE 13C ที่ระบุว่า "ห้ามแก้ RLS"
เอกสารนี้จึงทำหน้าที่เป็น **รายงานความพร้อม (Readiness Report)** + **แผนการ Deploy เมื่อพร้อม** แทนการ Deploy จริง

ประเด็นสำคัญที่พบระหว่างตรวจสอบ (สรุปจากหัวข้อ 1–3 ด้านล่าง):

| ปัญหา | ระดับ | สถานะ |
|---|---|---|
| RLS มีช่องโหว่ Critical (อ่านข้อมูลได้โดยไม่ Login) | 🔴 Critical | รอ CEO/Architect อนุมัติแก้ (ดู `docs/authenticated-rls-final-report.md`) |
| `js/config/supabase.js` ใส่ Anon Key เป็นค่า placeholder `'******'` ทำให้ Login ใช้งานจริงไม่ได้ | 🔴 Blocker | ยังไม่แก้ (ต้องรอ RLS fix ก่อนตามมติ CEO) |
| ไม่มี `.gitignore` / `.vercelignore` — หาก Deploy ตอนนี้ไฟล์ลับ (.env, docs/test-accounts.md, database/, scripts/*.json ที่มี JWT จริง) จะถูกอัปโหลดเป็นไฟล์สาธารณะ | 🔴 Critical | ต้องสร้างก่อน Deploy ทุกครั้ง |
| Vercel CLI พร้อมใช้งานและ Login สำเร็จ (บัญชี `priffer`) | 🟢 พร้อม | ใช้งานได้ทันทีเมื่อได้รับอนุมัติ |
| Tailwind CSS Build ผ่าน (`dist/output.css` สร้างสำเร็จ) | 🟢 พร้อม | ใช้ได้ (มี caveat เรื่อง `chmod` บน Windows — ดูหัวข้อ 1) |

---

## 1. ผลตรวจสอบ Build

คำสั่ง Build ที่กำหนดใน `package.json`:
```
"build": "chmod +x ./node_modules/.bin/tailwindcss && npx tailwindcss -i ./src/input.css -o ./dist/output.css --minify"
```

- บน **Windows (PowerShell)**: คำสั่ง `chmod` ไม่มีในระบบ ทำให้ `npm run build` ล้มเหลวที่ขั้นตอนนี้ (exit code 1)
- เมื่อรันคำสั่ง `npx tailwindcss -i ./src/input.css -o ./dist/output.css --minify` **โดยตรง (ข้าม chmod)** พบว่า Build **สำเร็จ** — ได้ไฟล์ `dist/output.css` (~38 KB) เรียบร้อย
- **สรุป:** Build ไม่มีปัญหาเชิง Logic/Syntax ปัญหาอยู่ที่สคริปต์ `chmod` ใช้ไม่ได้บน Windows เท่านั้น (Vercel ใช้ Linux build environment ซึ่งมี `chmod` อยู่แล้ว จึงคาดว่า Build บน Vercel จะผ่านได้ปกติโดยไม่ต้องแก้ไขอะไร)
- ไม่ได้แก้ไข `package.json` ในรอบนี้ (เป็นไปตามหลัก "ไม่แก้สิ่งที่ไม่จำเป็นต่อภารกิจ")

---

## 2. ผลตรวจสอบหน้า Login / Dashboard

### ไฟล์ที่มีอยู่จริงในโปรเจกต์ (top-level HTML)
`index.html`, `login.html`, `employee-login.html`, `dashboard.html`, `employee-dashboard.html`,
`admin-employees.html`, `admin-attendance.html`, `admin-jobs.html`, `apply.html`

> หมายเหตุ: หน้า `admin-payroll.html`, `admin-reports.html`, `admin-settings.html`,
> `attendance.html`, `payslip.html`, `advance.html` ที่เคยพูดถึงใน PHASE 10 **ยังไม่มีอยู่จริงในโปรเจกต์**
> (ฟังก์ชันเหล่านี้อาจถูกรวมไว้ใน `employee-dashboard.html` / `dashboard.html` เป็น Section/Tab แทน)

### สถานะ Auth Guard
ติดตั้ง `js/auth/auth-guard.js` แล้วในหน้า:
- ✅ `dashboard.html`
- ✅ `admin-employees.html`
- ✅ `admin-attendance.html`
- ✅ `admin-jobs.html`
- ✅ `employee-dashboard.html`

ไม่ติดตั้ง (ถูกต้องตามออกแบบ เพราะเป็นหน้า Public/Entry point):
- `index.html`, `login.html`, `employee-login.html`, `apply.html`

### 🔴 Blocker: `js/config/supabase.js` ใช้ Anon Key ปลอม
```js
const SUPABASE_URL = 'https://hcyibcqojsyldiyzperr.supabase.co';
const SUPABASE_KEY = '******';   // <-- placeholder ตั้งแต่ commit แรก (18763ff)
```
ค่านี้เป็น Placeholder มาตั้งแต่ Commit ที่สร้างไฟล์ (`18763ff — fix: enforce sharp edges on all pages`)
ทำให้ `supabase.createClient()` เชื่อมต่อไม่ได้จริง **หน้า Login จะ Error ทันทีที่กดเข้าสู่ระบบ**

**Agent ยังไม่แก้ไขค่านี้ในรอบนี้** เพราะ:
1. ผูกกับความเสี่ยงเดียวกับ RLS (การใส่ Anon Key จริงจะทำให้ Client เชื่อมต่อ DB จริงได้ ซึ่งขณะนี้ DB มีช่องโหว่ Critical อยู่)
2. CEO เลือกให้ "รอแก้ RLS ก่อน" ซึ่ง Agent ตีความว่ารวมถึงการเปิดใช้งาน Anon Key จริงด้วย (เพราะเป็นประตูเดียวกัน)

---

## 3. ผลตรวจสอบความปลอดภัยก่อน Deploy ไปยัง Vercel

### 3.1 Deploy จะไม่แก้ Schema/ข้อมูลจริงหรือไม่?
**ถูกต้อง — Deploy ไป Vercel เป็นการอัปโหลด Static Files (HTML/CSS/JS) เท่านั้น ไม่มีการรัน Migration หรือแก้ข้อมูลใดๆ ใน Database**
Vercel ไม่มีสิทธิ์เข้าถึง `DATABASE_URL` หรือรันคำสั่ง SQL ใดๆ ทั้งสิ้น

### 3.2 แต่พบความเสี่ยงร้ายแรง 2 ข้อที่ต้องแก้ก่อน Deploy จริง

**(1) ไม่มี `.gitignore` และ `.vercelignore` ในโปรเจกต์**
ถ้า Deploy ตอนนี้ (`outputDirectory: "."` ตาม `vercel.json`) ไฟล์ต่อไปนี้จะถูกอัปโหลดเป็น **ไฟล์สาธารณะที่ใครก็เปิดดู URL ตรงๆ ได้**:
- `.env` → มี `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (สิทธิ์ Admin เต็ม!), `SUPABASE_ANON_KEY`
- `docs/test-accounts.md` → มีรหัสผ่านทดสอบจริงของบัญชี QA 4 บัญชี
- `scripts/p13-sessions-result.json` → มี JWT Token จริงที่ Login ได้จริง
- `database/*.sql` → เห็นโครงสร้างตาราง/Policy ทั้งหมด

**นี่คือความเสี่ยงที่ร้ายแรงที่สุดของงานนี้ — ต้องสร้าง `.gitignore`/`.vercelignore` ก่อน Deploy ทุกครั้งไม่มีข้อยกเว้น**

**(2) ช่องโหว่ RLS Critical ที่ค้นพบใน PHASE 13A ยังไม่ได้แก้**
อ้างอิง `docs/authenticated-rls-final-report.md` — พบว่าปัจจุบันสามารถอ่านข้อมูล `attendance_logs` และ `user_profiles`
ได้โดย **ไม่ต้อง Login เลย** (ใช้แค่ Anon Key) เนื่องจาก Policy เก่าที่มี `USING(true)` ยังไม่ถูกลบออก
ถ้า Deploy พร้อมใส่ Anon Key จริง จะทำให้ **ใครก็ตามที่เจอ URL สาธารณะสามารถดึงข้อมูลพนักงานจริงออกไปได้ทันที**

### 3.3 สถานะ Vercel Account
- ตรวจสอบด้วย `npx vercel whoami` → พบว่า Environment นี้มี Vercel Session ที่ Login ไว้แล้วในชื่อบัญชี **`priffer`**
- Vercel CLI พร้อมใช้งาน (v58.5.1) และสามารถ Deploy ได้ทันทีเมื่อได้รับอนุมัติ

### สรุปผลการประเมิน: **ยังไม่ปลอดภัยพอที่จะ Deploy** ตามเงื่อนไข "ถ้าปลอดภัยให้ Deploy" ของคำสั่งต้นทาง
→ Agent จึงหยุดที่ขั้นตอนนี้และไม่ Deploy จริง ตามการตัดสินใจของ CEO ที่ให้รอแก้ RLS ก่อน

---

## 4. แผนงานเมื่อพร้อม Deploy (รอ CEO/Architect อนุมัติ)

เมื่อได้รับอนุมัติให้แก้ไข RLS (per `docs/authenticated-rls-final-report.md` หัวข้อ 7) ลำดับขั้นตอนที่แนะนำ:

1. แก้ 3 ช่องโหว่ Critical ของ RLS (ลบ Legacy Policy `USING(true)`, เปิด RLS บน `user_profiles`/`supervisor_client_assignments`, แก้ Infinite Recursion ของ `employees_select_self`)
2. Re-run `scripts/p13_rls_auth_tests.js` ให้ผ่าน 100%
3. สร้าง `.gitignore` และ `.vercelignore` แยกไฟล์ลับ (`.env`, `docs/test-accounts.md`, `scripts/*result*.json`, `database/`) ออกจากการ Deploy
4. ใส่ `SUPABASE_ANON_KEY` จริงลงใน `js/config/supabase.js` (ค่านี้เป็น Anon Key ที่ออกแบบให้เปิดเผยต่อ Client ได้ตามปกติของ Supabase — ปลอดภัย **ก็ต่อเมื่อ** RLS ทำงานถูกต้องแล้วเท่านั้น)
5. พิจารณาเปิด **Vercel Deployment Protection** (Password Protection / ต้อง Vercel Pro Plan) เพื่อจำกัดไม่ให้คนนอกเข้าถึง URL Demo ได้
6. Deploy แบบ Preview ก่อน (ไม่ใช่ Production URL) เพื่อจำกัดวงผู้เข้าถึง แล้วส่ง URL ให้ CEO โดยตรง ไม่เผยแพร่สาธารณะ
7. หลัง CEO ทดสอบเสร็จ ให้ลบ/หมุนเวียน (Rotate) รหัสผ่านบัญชี QA 4 บัญชีทันที (Admin API Delete พร้อมใช้แล้ว)

---

## 5. ข้อมูลสำหรับการทดสอบ (เมื่อ Deploy สำเร็จในอนาคต)

> ⚠️ ยังใช้งานไม่ได้ในตอนนี้ เนื่องจากยังไม่ Deploy — ระบุไว้ล่วงหน้าเพื่อเตรียมพร้อม

| Role | Email | หมายเหตุ |
|---|---|---|
| Admin | `qa-admin@kc-clean.internal` | ดู Temp Password ใน `docs/test-accounts.md` (ไฟล์นี้จะไม่ถูก Deploy ขึ้น Vercel) |
| Payroll | `qa-payroll@kc-clean.internal` | เช่นเดียวกัน |
| Supervisor | `qa-supervisor@kc-clean.internal` | เช่นเดียวกัน |
| Employee | `qa-employee@kc-clean.internal` | เช่นเดียวกัน |

**ห้ามใช้บัญชี `admin@kccleantrade.com` ในการทดสอบเด็ดขาด** (เป็นบัญชีจริงที่พบก่อนหน้านี้ ไม่ใช่บัญชีทดสอบ)

### เมนูที่ควรทดลอง (เมื่อ Deploy แล้ว)
- Login ผ่าน `login.html` (Admin/Payroll) และ `employee-login.html` (Employee)
- `dashboard.html` — ภาพรวม Admin
- `admin-employees.html` — จัดการพนักงาน
- `admin-attendance.html` — บันทึกเวลาเข้า-ออก
- `admin-jobs.html` — จัดการงาน/Job Site
- `employee-dashboard.html` — มุมมองพนักงาน (Self-service)

### สิ่งที่คาดว่าจะทำงานได้
- หน้าตา UI/Layout ทั้งหมด (Build CSS ผ่านแล้ว)
- Auth Guard ปิดกั้นหน้า Admin จากผู้ไม่มีสิทธิ์ (ทดสอบ Logic ผ่านแล้วใน PHASE 10)
- การ Login จริงผ่าน Supabase Auth (เมื่อใส่ Anon Key จริงแล้ว)

### สิ่งที่ยังไม่เสร็จ / ยังทดสอบไม่ได้
- **Payroll Engine** (ตามเอกสาร `docs/payroll-architecture.md`) — ยังอยู่ระหว่างออกแบบ ยังไม่ผูกกับหน้าจอจริง
- **Attendance Module** ขั้นสูง (OT 36 ชม./สัปดาห์ Validation ฯลฯ) — Migration/Schema พร้อมแล้ว แต่ยังไม่ครบ Flow หน้าบ้าน
- ความถูกต้องของ RLS ระดับ Production (ต้องรอแก้ไข Critical Issues ก่อน)
- หน้า `admin-payroll.html`, `admin-reports.html`, `admin-settings.html` — ยังไม่มีไฟล์อยู่จริงในโปรเจกต์

---

## 6. สิ่งที่ Agent ไม่ได้ทำในรอบนี้ (ตามข้อห้าม)
- ❌ ไม่ได้แก้ไข RLS Policy ใดๆ
- ❌ ไม่ได้แก้ไข Schema ฐานข้อมูล
- ❌ ไม่ได้สร้าง Feature ใหม่
- ❌ ไม่ได้ Deploy ระบบขึ้น Vercel จริง (ตามมติ CEO ให้รอแก้ RLS ก่อน)
- ❌ ไม่ได้แก้ไข `js/config/supabase.js` (Anon Key ยังเป็น placeholder อยู่)
- ❌ ไม่ได้สร้าง `.gitignore`/`.vercelignore` (รอทำพร้อมกันตอน Deploy จริงตามแผนหัวข้อ 4)

---

**สรุป:** ระบบพร้อมด้าน Build/UI แต่ **ยังไม่ปลอดภัยพอที่จะ Deploy ให้ CEO เข้าถึงผ่าน Internet จริง**
เนื่องจากช่องโหว่ RLS Critical และความเสี่ยงข้อมูลลับรั่วไหลจากการไม่มีไฟล์ Ignore
รอคำสั่งอนุมัติแก้ไข RLS ในเฟสถัดไปตามที่ CEO เลือกไว้
