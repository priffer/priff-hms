# Implementation Roadmap (Roadmap การนำไปใช้) — PRIFF-HMS

เอกสารนี้สรุปแผนปฏิบัติการแบบเป็นขั้นตอน (Step-by-Step) สำหรับการนำฟีเจอร์ Payroll และ RLS เข้าสู่ Staging ตามมติ AI Architecture Board

สถานะระบบ: OFFICIAL BUILD MODE & FEATURE FREEZE 🔒
ลำดับการทำงานหลัก: Database Migration -> Auth & Route Guard -> Attendance & Audit -> Payroll Engine

ระยะเวลาแนะนำโดยรวม: 8–12 สัปดาห์ (ขึ้นกับขนาดข้อมูลและทรัพยากรทีม)

---

Milestone 1: Staging Database Migration & Verification (1–2 สัปดาห์)

เป้าหมาย
- รัน `database/01_payroll_migration_v2.sql` บน Staging DB และยืนยัน schema ใหม่, RLS functions, triggers, ตาราง payroll

งานหลัก
1. เตรียม Staging environment (snapshot ของ production) และสำรองข้อมูลก่อนรัน
2. Review script กับ DBA/Lead Developer (walkthrough) — เน้น PART 1–5 ในไฟล์ v2
3. รัน script บน Staging ตามขั้นตอนใน `docs/staging-execution-guide.md`
4. รันชุด SQL Verification (ดูไฟล์ staging guide) เพื่อยืนยัน Data Integrity
5. Backfill minimal dataset สำหรับ user_profiles (mapping auth_uid) โดย batch เพื่อจำลองการใช้งาน
6. ตรวจสอบ RLS helper functions และทดสอบ policy scenarios ด้วย user test accounts

ผลลัพธ์ที่ต้องได้
- Schema ใหม่สร้างเสร็จสมบูรณ์ (ตาราง, index, triggers, functions)
- user_profiles ถูก populate อย่างน้อยกับผู้ทดสอบหลัก
- RLS policies ทำงานและไม่บล็อก admin/pw flows ที่จำเป็น

Acceptance Criteria
- สคริปต์รันสำเร็จบน Staging ไม่มี error ที่เป็น blocker
- ตัวอย่าง SELECT/INSERT/UPDATE/DELETE ทดสอบสำหรับแต่ละ role ทำงานตาม permission matrix
- รายงานปัญหา (if any) พร้อมแผนแก้ไข

---

Milestone 2: Authentication & Page Route Guard (1–2 สัปดาห์)

เป้าหมาย
- ปรับระบบ Authentication ให้สอดคล้อง (Supabase Auth + Synthetic Email for employees)
- นำ route guards เข้าสู่ frontend (auth-guard.js) และลบการเก็บ session ใน localStorage

งานหลัก
1. ออกแบบ/implement auth-guard.js (client-side) — ตรวจสอบ session จาก `supabase.auth.getSession()` และเรียก user_profiles via secure API/view
2. สร้าง onboarding script สำหรับสร้าง Synthetic Email accounts และเชื่อม user_profiles.employee_id
3. ห้ามใช้ localStorage สำหรับ token/session — ล้าง key `priff_emp_session` และเปลี่ยน flow ให้ใช้ Supabase session / HttpOnly cookie (ถ้ามี service layer)
4. ขยาย login flows: Admin sign-in (unchanged), Employee sign-in -> Supabase Auth (password or OTP)
5. Test cases: unauthorized access, expired session, role mismatch

ผลลัพธ์ที่ต้องได้
- auth-guard.js ตรวจจับ role/status และ redirect เมื่อไม่ได้รับสิทธิ์
- พนักงานทุกคนมี Supabase Auth account เชื่อมกับ user_profiles
- Legacy localStorage session ถูกปิดใช้งานและล้างได้

Acceptance Criteria
- หน้า admin และ employee ทุกหน้ามี guard และทดสอบสำเร็จ
- ไม่มีการอ่าน token จาก localStorage ใน audit of frontend bundle

---

Milestone 3: Attendance Module & Supervisor Scope (2–3 สัปดาห์)

เป้าหมาย
- เชื่อม supervisor scope ด้วย `supervisor_client_assignments`
- เปิดใช้งาน `attendance_audit_logs` และ audit workflow
- ย้าย logic OT aggregation ไปยัง DB triggers/functions และ/or Edge Function

งานหลัก
1. Integrate frontend admin supervisor UI ให้ผูกกับ `supervisor_client_assignments`
2. เติม workflow: supervisor assign client -> บันทึก mapping -> ทดสอบ policy access
3. เปิดใช้งาน triggers: `trg_attendance_compute_weekly_ot`, `trg_attendance_audit`, `trg_attendance_modify_allowed`
4. สร้าง process manual-override ที่บันทึก `attendance_audit_logs` พร้อม `edited_by` และ `reason`
5. Test OT 36 ชั่วโมง rule: สร้าง test data ที่เกิน แล้วตรวจสอบ flagged behavior และห้ามอนุมัติ payroll อัตโนมัติ

ผลลัพธ์ที่ต้องได้
- Supervisor เห็นเฉพาะ site ที่ assign
- Audit logs บันทึกการแก้ไขทุกครั้งและสามารถตรวจสอบย้อนหลังได้
- การ flagged OT ต้องป้องกันการอนุมัติ auto pay

Acceptance Criteria
- Supervisor test accounts ผ่าน permission matrix
- Audit trail sample มี record ที่ครบ (old_values, new_values, edited_by)

---

Milestone 4: Payroll Engine & Payslip Generation (2–4 สัปดาห์)

เป้าหมาย
- พัฒนา Payroll Processing Layer (Edge Function หรือ Backend) ที่อ่าน attendance, advance_payments และ payroll_rates เพื่อสร้าง payroll_runs, payroll_lines และ payslips
- รองรับ Daily SSO Cap และสูตร MIN(Daily * 0.05, MAX(0, 875 - YTD_SSO))
- State machine สำหรับ payroll_periods/payroll_runs (draft -> submitted -> approved -> locked)

งานหลัก
1. สร้าง Payroll Orchestrator (Edge Function) ที่รัน batch processing per payroll_period
2. Implement calculation modules:
   - Base pay (monthly/daily/hourly)
   - OT (ot15, ot2, ot3) ใช้ columns ot15_hours, ot2_hours, ot3_hours
   - Social Security (SSO) calculation ตามสูตร Daily SSO Cap และ YTD adjustment
   - Withholding tax (YTD PIT engine) ที่อิง payroll_ytd_summary
   - Advance payment deduction linking
3. เขียนผลลัพธ์ลงตาราง payroll_runs, payroll_lines, payroll_line_details, payroll_payslips ภายใต้ transaction per employee or per run
4. Implement approval workflow UI และ API ที่เปลี่ยนสถานะ (draft -> submitted -> approved -> locked)
5. เมื่อ approved/locked: ห้ามแก้ไข attendance ที่เกี่ยวข้อง (implicit lock enforced by triggers)

ผลลัพธ์ที่ต้องได้
- Payroll run ถูกสร้างและคำนวณถูกต้องสำหรับชุด test data
- Payslip PDF/HTML generator ทำงานและเก็บลิงก์ใน payroll_payslips.payslip_url
- YTD summaries อัปเดตหลังการทำ payroll run

Acceptance Criteria
- ตัวอย่าง payroll run ผ่าน validation rules (SSO cap, OT limit handling, advance deduction)
- Approval workflow ถูกบันทึก (approved_by, approved_at, locked_at)

---

Milestone 5: Testing, Security Audit & Cutover Plan (1–2 สัปดาห์)

เป้าหมาย
- ทำ QA, Security Review, Pen Test และเตรียม Cutover Plan สำหรับ production

งานหลัก
1. สร้าง test plan: unit tests, integration tests (Edge Functions), security tests (RLS policies), performance tests (large attendance dataset)
2. Conduct security review / penetration test focusing on:
   - RLS policies coverage
   - Supabase key exposure in UI
   - XSS vectors that could read cookies/localStorage
3. Operational readiness:
   - Backup plan (full logical dump)
   - Rollback playbook (see docs/migration-checklist.md)
   - Communication plan and maintenance window
4. Cutover dry-run on staging: complete migration + auth roll-out + payroll run end-to-end

Acceptance Criteria
- Security issues of critical/high severity addressed or mitigated
- Successful dry-run with stakeholder sign-off

---

Governance, Roles & Owners
- Tech Lead / Architect: ownership of roadmap, approvals
- DBA / DevOps: run migration and backups
- Backend/Edge Developer: payroll engine and API
- Frontend Developer: auth-guard.js, route guard, UI changes
- HR/Payroll SME: validation of payroll calculations and legal compliance
- QA/Security: tests, RLS validation, pen-test

---

Deliverables per milestone
- Migration scripts reviewed + executed on Staging
- Auth/Route Guard implemented and verified
- Supervisor assignments + Attendance audit enabled
- Payroll Engine with sample runs and payslips
- Test reports, security report, cutover checklist

---

Notes
- ห้ามแก้โค้ดหลักหรือรันสคริปต์บน production จนกว่า milestone 1–4 บน Staging ผ่านการยืนยัน
- แยก heavy backfill job ออกเป็น batch jobs และรันนอกชั่วโมงทำงานเพื่อลดผลกระทบต่อระบบ


เอกสารนี้เป็นแผน implementation ฉบับสรุป — หากต้องการ จะขยายเป็น tasks แบบ Jira/CSV รายวันได้ตามคำขอ
