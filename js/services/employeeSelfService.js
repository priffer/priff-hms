// js/services/employeeSelfService.js
// บริการฝั่งพนักงาน (ESS Self-Service): เบิกเงินล่วงหน้า, ลางาน, สลิปเงินเดือน, ประวัติลงเวลา
// ทุกฟังก์ชันพึ่งพา RLS policies (database/06_leave_management.sql, database/07_advance_payments_rls.sql)
// เพื่อจำกัดให้พนักงานเห็น/แก้ไขได้เฉพาะข้อมูลของตัวเองเท่านั้น ไม่ได้กรองด้วย client-side logic

// จัดรูปแบบวันที่เป็น YYYY-MM-DD ตาม "เวลาท้องถิ่นของเบราว์เซอร์" ห้ามใช้ .toISOString()
// ตรงนี้เด็ดขาด เพราะ toISOString() แปลงเป็น UTC ก่อน ทำให้วันที่เพี้ยนถอยหลังไป 1 วันในโซนเวลา
// ที่เร็วกว่า UTC เช่นประเทศไทย (UTC+7) - พบบั๊กนี้จริงระหว่างทดสอบคำนวณรอบปีลาพักร้อน
function toLocalDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

const EmployeeSelfService = {
    // ---------- ขอเบิกเงินล่วงหน้า ----------
    async getMyAdvancePayments(empId) {
        const { data, error } = await supabaseClient
            .from('advance_payments')
            .select('*')
            .eq('emp_id', empId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async createAdvancePaymentRequest({ empId, companyId, amount, remark }) {
        const payload = {
            emp_id: empId,
            company_id: companyId,
            amount,
            status: 'pending',
            employee_remark: remark || null
        };
        const { error } = await supabaseClient.from('advance_payments').insert([payload]);
        if (error) throw error;
    },

    // ---------- ขออนุมัติลางาน ----------
    async getLeaveTypes() {
        const { data, error } = await supabaseClient
            .from('leave_types')
            .select('*')
            .eq('is_active', true)
            .order('code', { ascending: true });
        if (error) throw error;
        return data;
    },

    // ---------- Helper: คำนวณรอบ "ปีของการทำงาน" ของลาพักร้อน (16 ธ.ค.-16 ธ.ค. ปีถัดไป ตามระเบียบที่ 7) ----------
    // ปีที่ 1 = ตั้งแต่วันเริ่มงานถึง 15 ธันวาคมแรกที่เจอ (หรือ 15 ธันวาคม ปีถัดไป ถ้าเริ่มงานช่วง 16-31 ธ.ค.)
    // ปีที่ 2 เป็นต้นไป = รอบเต็ม 16 ธ.ค.-15 ธ.ค. ปีถัดไป ต่อเนื่องกันไปเรื่อยๆ นับจากปีที่ 1
    _computeAnnualLeaveCycle(hireDateStr, refDate) {
        let cycleStart = new Date(hireDateStr + 'T00:00:00');
        let workYear = 1;
        for (let i = 0; i < 100; i++) {
            const y = cycleStart.getFullYear();
            const dec15ThisYear = new Date(y, 11, 15);
            const cycleEnd = cycleStart <= dec15ThisYear ? dec15ThisYear : new Date(y + 1, 11, 15);
            if (refDate <= cycleEnd) {
                return { workYear, cycleStart: new Date(cycleStart), cycleEnd };
            }
            cycleStart = new Date(cycleEnd);
            cycleStart.setDate(cycleStart.getDate() + 1);
            workYear++;
        }
        throw new Error('_computeAnnualLeaveCycle: exceeded max iterations - ตรวจสอบวันเริ่มงานผิดปกติ');
    },

    // ---------- Helper: หาจำนวนวันลาพักร้อนที่มีสิทธิ์ ตามปีของการทำงาน/ตารางปีแรก (ระเบียบที่ 7 ตาราง 1-2) ----------
    _lookupAnnualEntitlement(workYear, hireDateStr, tenureTiers, firstYearTable) {
        if (workYear === 1) {
            const hireDate = new Date(hireDateStr + 'T00:00:00');
            const hireVal = (hireDate.getMonth() + 1) * 100 + hireDate.getDate();
            const match = (firstYearTable || []).find(row => {
                const startVal = row.start_month * 100 + row.start_day;
                const endVal = row.end_month * 100 + row.end_day;
                return hireVal >= startVal && hireVal <= endVal;
            });
            return match ? Number(match.entitled_days) : 0;
        }
        const tier = (tenureTiers || []).find(t => workYear >= t.min_work_year && (t.max_work_year === null || workYear <= t.max_work_year));
        return tier ? Number(tier.entitled_days) : null;
    },

    // สรุปยอดวันลาคงเหลือของพนักงาน แยกตามประเภทลา ตรงตามระเบียบสวัสดิการจริงของบริษัท:
    //   - ลาป่วย/ลากิจ/ลาไม่รับค่าจ้าง (annual_quota + calendar): โควตาต่อปีปฏิทิน (ม.ค.-ธ.ค.) เหมือนเดิม
    //   - ลาพักร้อน (annual_quota + company_fiscal): ใช้ "ปีของการทำงาน" 16 ธ.ค.-15 ธ.ค. ปีถัดไป
    //     ปีแรก prorate ตามเดือนเริ่มงาน ปีที่ 2 ขึ้นไปคิดขั้นบันไดตามอายุงาน (ดู _lookupAnnualEntitlement)
    //   - ลาบวช/ลาแต่งงาน/ลากรณีภรรยาคลอดบุตร/งานศพ/คลอดบุตร (event_based): ไม่ใช่โควตารายปี
    //     แต่เป็นสิทธิ์ตามเหตุการณ์ บางประเภทจำกัดจำนวนครั้งตลอดการทำงาน (max_occurrences_lifetime)
    //     บางประเภทต้องมีอายุงานขั้นต่ำก่อน (min_tenure_days) - แสดง isEligible ให้ UI ใช้กำหนดสถานะ
    // ทุกค่าคำนวณสดจากข้อมูลจริงเสมอ ไม่พึ่งฟิลด์ used_days ที่ไม่มีโค้ดส่วนไหนเขียนอัปเดต
    async getMyLeaveBalanceSummary(employeeId, empId) {
        const today = new Date();
        const calYear = today.getFullYear();
        const calYearStart = `${calYear}-01-01`;
        const calYearEnd = `${calYear}-12-31`;

        const [typesRes, empRes, balancesRes, allRequestsRes, tiersRes, firstYearRes] = await Promise.all([
            supabaseClient.from('leave_types').select('*').eq('is_active', true).order('code', { ascending: true }),
            supabaseClient.from('employees').select('available_start_date').eq('id', employeeId).maybeSingle(),
            supabaseClient.from('leave_balances').select('leave_type_id, entitled_days').eq('employee_id', employeeId).eq('year', calYear),
            supabaseClient.from('leave_requests').select('leave_type_id, total_days, start_date, status').eq('emp_id', empId).in('status', ['approved', 'pending']),
            supabaseClient.from('annual_leave_tenure_tiers').select('*'),
            supabaseClient.from('annual_leave_first_year_proration').select('*')
        ]);
        if (typesRes.error) throw typesRes.error;
        if (empRes.error) throw empRes.error;
        if (balancesRes.error) throw balancesRes.error;
        if (allRequestsRes.error) throw allRequestsRes.error;
        if (tiersRes.error) throw tiersRes.error;
        if (firstYearRes.error) throw firstYearRes.error;

        const hireDateStr = empRes.data?.available_start_date || null;
        const overrideMap = {};
        (balancesRes.data || []).forEach(b => { overrideMap[b.leave_type_id] = b.entitled_days; });

        const allRequests = allRequestsRes.data || [];
        const annualCycle = hireDateStr ? this._computeAnnualLeaveCycle(hireDateStr, today) : null;
        const tenureDays = hireDateStr ? Math.floor((today - new Date(hireDateStr + 'T00:00:00')) / 86400000) : null;

        return (typesRes.data || []).map(type => {
            const base = { leaveTypeId: type.id, code: type.code, nameTh: type.name_th, isPaid: type.is_paid, entitlementModel: type.entitlement_model, requiresAttachment: type.requires_attachment };

            // ---------- สิทธิ์ตามเหตุการณ์ (ไม่ใช่โควตารายปี) ----------
            if (type.entitlement_model === 'event_based') {
                const tenureOk = !type.min_tenure_days || (tenureDays !== null && tenureDays >= type.min_tenure_days);
                const usedOccurrences = allRequests.filter(r => r.leave_type_id === type.id).length;
                return {
                    ...base,
                    maxDaysPerOccurrence: type.max_days_per_occurrence !== null ? Number(type.max_days_per_occurrence) : null,
                    maxOccurrencesLifetime: type.max_occurrences_lifetime,
                    usedOccurrences,
                    isEligible: tenureOk,
                    ineligibleReason: tenureOk ? null : `ต้องมีอายุงานอย่างน้อย ${Math.ceil(type.min_tenure_days / 365)} ปี`
                };
            }

            // ---------- ลาพักร้อน: รอบปีของการทำงาน (16 ธ.ค.-15 ธ.ค.) ----------
            if (type.leave_year_cycle === 'company_fiscal') {
                if (!hireDateStr || !annualCycle) {
                    return { ...base, entitled: null, used: 0, remaining: null, cycleNote: 'ไม่พบวันที่เริ่มงานในระบบ ไม่สามารถคำนวณสิทธิ์ลาพักร้อนได้ กรุณาติดต่อฝ่ายบุคคล' };
                }
                const entitled = this._lookupAnnualEntitlement(annualCycle.workYear, hireDateStr, tiersRes.data, firstYearRes.data);
                const cycleStartStr = toLocalDateStr(annualCycle.cycleStart);
                const cycleEndStr = toLocalDateStr(annualCycle.cycleEnd);
                const used = allRequests
                    .filter(r => r.leave_type_id === type.id && r.status === 'approved' && r.start_date >= cycleStartStr && r.start_date <= cycleEndStr)
                    .reduce((sum, r) => sum + Number(r.total_days), 0);
                return {
                    ...base,
                    entitled,
                    used,
                    remaining: entitled === null ? null : Math.max(entitled - used, 0),
                    workYear: annualCycle.workYear,
                    cycleStart: cycleStartStr,
                    cycleEnd: cycleEndStr
                };
            }

            // ---------- ลาป่วย/ลากิจ/ลาไม่รับค่าจ้าง: โควตาต่อปีปฏิทิน (เดิม) ----------
            const entitled = overrideMap[type.id] !== undefined ? Number(overrideMap[type.id]) : (type.max_days_per_year !== null ? Number(type.max_days_per_year) : null);
            const used = allRequests
                .filter(r => r.leave_type_id === type.id && r.status === 'approved' && r.start_date >= calYearStart && r.start_date <= calYearEnd)
                .reduce((sum, r) => sum + Number(r.total_days), 0);
            return {
                ...base,
                entitled,
                used,
                remaining: entitled === null ? null : Math.max(entitled - used, 0)
            };
        });
    },

    async getMyLeaveRequests(empId) {
        const { data, error } = await supabaseClient
            .from('leave_requests')
            .select('*, leave_types(name_th, code)')
            .eq('emp_id', empId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async createLeaveRequest({ empId, employeeId, companyId, leaveTypeId, startDate, endDate, totalDays, reason, attachmentUrl }) {
        const payload = {
            emp_id: empId,
            employee_id: employeeId,
            company_id: companyId,
            leave_type_id: leaveTypeId,
            start_date: startDate,
            end_date: endDate,
            total_days: totalDays,
            reason: reason || null,
            attachment_url: attachmentUrl || null,
            status: 'pending'
        };
        const { error } = await supabaseClient.from('leave_requests').insert([payload]);
        if (error) throw error;
    },

    // อัปโหลดไฟล์แนบประกอบการลา (ใบมรณบัตร/การ์ดเชิญแต่งงาน/สูติบัตร ฯลฯ) ใช้ bucket เดียวกับ
    // ไฟล์แนบประกาศบริษัท เพราะเป็นไฟล์เอกสารประกอบเหมือนกัน ไม่จำเป็นต้องแยก bucket ใหม่
    async uploadLeaveAttachment(file, fileName) {
        const path = `leave_requests/${fileName}`;
        const { error } = await supabaseClient.storage
            .from('announcement_attachments')
            .upload(path, file, { upsert: true });
        if (error) throw error;
        const { data } = supabaseClient.storage.from('announcement_attachments').getPublicUrl(path);
        return data.publicUrl;
    },

    async cancelLeaveRequest(id, empId) {
        const { error } = await supabaseClient
            .from('leave_requests')
            .update({ status: 'cancelled' })
            .eq('id', id)
            .eq('emp_id', empId);
        if (error) throw error;
    },

    // ---------- สลิปเงินเดือน ----------
    async getMyPayslips(employeeId) {
        const { data, error } = await supabaseClient
            .from('payroll_payslips')
            .select('*')
            .eq('employee_id', employeeId)
            .order('payslip_date', { ascending: false });
        if (error) throw error;
        return data;
    },

    // ---------- ประวัติลงเวลา ----------
    async getMyAttendanceHistory(empId, { limit = 30 } = {}) {
        const { data, error } = await supabaseClient
            .from('attendance_logs')
            .select('*, clients(client_name)')
            .eq('emp_id', empId)
            .order('work_date', { ascending: false })
            .limit(limit);
        if (error) throw error;
        return data;
    },

    // ---------- กะการทำงาน (ใช้คำนวณมาสาย/ออกก่อน/ทำงานเกินกะในหน้าประวัติลงเวลา) ----------
    // คืนประวัติกะทั้งหมด (ไม่ใช่แค่กะปัจจุบัน) เพราะ work_date ในอดีตอาจอยู่ในช่วงกะเก่าที่ถูก
    // เปลี่ยนไปแล้ว - ฝั่ง UI จะเลือกกะที่ตรงกับ effective_from/effective_to ของแต่ละ work_date เอง
    async getMyShiftHistory(employeeId) {
        const { data, error } = await supabaseClient
            .from('employee_shift_assignments')
            .select('*')
            .eq('employee_id', employeeId)
            .order('effective_from', { ascending: false });
        if (error) throw error;
        return data;
    },

    // ---------- ขอแก้ไขเวลาเข้า-ออกงาน (attendance_correction_requests) ----------
    async getMyCorrectionRequests(empId) {
        const { data, error } = await supabaseClient
            .from('attendance_correction_requests')
            .select('*, clients:requested_client_id(client_name)')
            .eq('emp_id', empId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    // เรียก RPC หาว่าใครควรเป็นผู้อนุมัติคำขอนี้ (ไซต์ที่ประจำอยู่ -> หัวหน้างานไซต์นั้น
    // หรือ fallback ไปแอดมิน/payroll) - ต้องเรียกก่อน insert เสมอ เพราะ RLS บังคับให้ค่าที่ส่งไป
    // ตรงกับผลลัพธ์ของฟังก์ชันนี้เป๊ะๆ (กันพนักงานปลอมแปลงว่าใครควรอนุมัติ)
    async resolveApproverForEmployee(employeeId) {
        const { data, error } = await supabaseClient.rpc('resolve_approver_for_employee', { p_employee_id: employeeId });
        if (error) throw error;
        return (data && data[0]) || { approver_role: 'admin', approver_user_profile_id: null };
    },

    async createCorrectionRequest({ empId, employeeId, companyId, attendanceLogId, workDate, requestedCheckIn, requestedCheckOut, requestedClientId, reason, attachmentUrl }) {
        const approver = await this.resolveApproverForEmployee(employeeId);
        const payload = {
            emp_id: empId,
            employee_id: employeeId,
            company_id: companyId,
            attendance_log_id: attendanceLogId || null,
            work_date: workDate,
            requested_check_in: requestedCheckIn || null,
            requested_check_out: requestedCheckOut || null,
            requested_client_id: requestedClientId || null,
            reason,
            attachment_url: attachmentUrl || null,
            status: 'pending',
            resolved_approver_role: approver.approver_role,
            resolved_approver_user_profile_id: approver.approver_user_profile_id
        };
        const { error } = await supabaseClient.from('attendance_correction_requests').insert([payload]);
        if (error) throw error;
    },

    // อัปโหลดไฟล์แนบประกอบคำขอแก้ไขเวลา (bucket เดียวกับไฟล์แนบลา แยก prefix)
    async uploadCorrectionAttachment(file, fileName) {
        const path = `attendance_corrections/${fileName}`;
        const { error } = await supabaseClient.storage
            .from('announcement_attachments')
            .upload(path, file, { upsert: true });
        if (error) throw error;
        const { data } = supabaseClient.storage.from('announcement_attachments').getPublicUrl(path);
        return data.publicUrl;
    },

    // ---------- กล่องอนุมัติสำหรับหัวหน้างาน (ใน ESS เพราะ supervisor เข้า Admin Portal ไม่ได้) ----------
    async getPendingApprovalsForSupervisor(userProfileId) {
        const { data, error } = await supabaseClient
            .from('attendance_correction_requests')
            .select('*, employees(full_name, emp_id), clients:requested_client_id(client_name)')
            .eq('resolved_approver_user_profile_id', userProfileId)
            .eq('status', 'pending')
            .order('created_at', { ascending: true });
        if (error) throw error;
        return data;
    },

    async approveCorrectionRequest(requestId) {
        const { data: req, error: fetchErr } = await supabaseClient
            .from('attendance_correction_requests')
            .select('*')
            .eq('id', requestId)
            .single();
        if (fetchErr) throw fetchErr;

        // อัปเดต/สร้างแถวใน attendance_logs ให้ตรงกับที่ขอ - ใช้ trigger fn_attendance_audit ที่มีอยู่แล้ว
        // บันทึก audit log การเปลี่ยนแปลงอัตโนมัติ ไม่ต้องเขียนเพิ่ม
        if (req.attendance_log_id) {
            const updatePayload = { manual_override_reason: `แก้ไขตามคำขอพนักงาน: ${req.reason}`, status: 'present' };
            if (req.requested_check_in) updatePayload.check_in = req.requested_check_in;
            if (req.requested_check_out) updatePayload.check_out = req.requested_check_out;
            if (req.requested_client_id) updatePayload.client_id = req.requested_client_id;
            const { error: updErr } = await supabaseClient.from('attendance_logs').update(updatePayload).eq('id', req.attendance_log_id);
            if (updErr) throw updErr;
        } else {
            const { error: insErr } = await supabaseClient.from('attendance_logs').insert([{
                emp_id: req.emp_id,
                employee_id: req.employee_id,
                company_id: req.company_id,
                client_id: req.requested_client_id,
                work_date: req.work_date,
                check_in: req.requested_check_in,
                check_out: req.requested_check_out,
                status: 'present',
                check_in_method: 'correction_request',
                manual_override_reason: `สร้างจากคำขอแก้ไขเวลาของพนักงาน: ${req.reason}`
            }]);
            if (insErr) throw insErr;
        }

        const { error } = await supabaseClient
            .from('attendance_correction_requests')
            .update({ status: 'approved', approved_at: new Date().toISOString() })
            .eq('id', requestId);
        if (error) throw error;
    },

    async rejectCorrectionRequest(requestId, rejectionReason) {
        const { error } = await supabaseClient
            .from('attendance_correction_requests')
            .update({ status: 'rejected', rejection_reason: rejectionReason || null, approved_at: new Date().toISOString() })
            .eq('id', requestId);
        if (error) throw error;
    },

    // ---------- ขอโอที (ot_requests) ----------
    // ผู้อนุมัติชั้นแรกและ safety net 36 ชม./สัปดาห์ ใช้ pattern เดียวกับ attendance_correction_requests
    // (resolve_approver_for_employee + weekly_ot_flagged) - เพดานชั่วโมงคำนวณฝั่ง DB ทั้งหมด
    // (trigger fn_ot_request_precheck ใน database/16_ot_requests.sql) ไม่เชื่อค่าที่ client ส่งมา
    async getMyOtRequests(empId) {
        const { data, error } = await supabaseClient
            .from('ot_requests')
            .select('*')
            .eq('emp_id', empId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async createOtRequest({ empId, employeeId, companyId, workDate, requestedStart, requestedEnd, requestedHours, reason, attachmentUrl }) {
        const approver = await this.resolveApproverForEmployee(employeeId);
        const payload = {
            emp_id: empId,
            employee_id: employeeId,
            company_id: companyId,
            work_date: workDate,
            requested_start: requestedStart || null,
            requested_end: requestedEnd || null,
            requested_hours: requestedHours,
            reason,
            attachment_url: attachmentUrl || null,
            status: 'pending',
            resolved_approver_role: approver.approver_role,
            resolved_approver_user_profile_id: approver.approver_user_profile_id
        };
        const { error } = await supabaseClient.from('ot_requests').insert([payload]);
        if (error) throw error;
    },

    // อัปโหลดไฟล์แนบประกอบคำขอโอที (bucket เดียวกัน แยก prefix "ot_requests/")
    async uploadOtAttachment(file, fileName) {
        const path = `ot_requests/${fileName}`;
        const { error } = await supabaseClient.storage
            .from('announcement_attachments')
            .upload(path, file, { upsert: true });
        if (error) throw error;
        const { data } = supabaseClient.storage.from('announcement_attachments').getPublicUrl(path);
        return data.publicUrl;
    },

    // คำขอโอทีที่รอหัวหน้างานคนนี้อนุมัติ (เฉพาะ status='pending' - ชั้น pending_admin_review
    // เป็นหน้าที่ของ admin/payroll ต่อ ไม่ใช่ supervisor แล้ว)
    async getPendingOtApprovalsForSupervisor(userProfileId) {
        const { data, error } = await supabaseClient
            .from('ot_requests')
            .select('*, employees(full_name, emp_id)')
            .eq('resolved_approver_user_profile_id', userProfileId)
            .eq('status', 'pending')
            .order('created_at', { ascending: true });
        if (error) throw error;
        return data;
    },

    // หัวหน้างานอนุมัติ: ถ้า requires_admin_review = true ให้เปลี่ยนสถานะเป็น pending_admin_review
    // (รอ admin/payroll ตรวจสอบเพิ่มอีกชั้น เพราะจะดันยอด OT เกิน 36 ชม./สัปดาห์ หรือเกินเพดานเดือน)
    // ถ้าไม่เกินเพดานใดเลย อนุมัติจบได้เลยชั้นเดียว
    async approveOtRequest(requestId, approverProfileId) {
        const { data: req, error: fetchErr } = await supabaseClient
            .from('ot_requests')
            .select('requires_admin_review')
            .eq('id', requestId)
            .single();
        if (fetchErr) throw fetchErr;
        const nextStatus = req.requires_admin_review ? 'pending_admin_review' : 'approved';
        const { error } = await supabaseClient
            .from('ot_requests')
            .update({ status: nextStatus, supervisor_approved_by: approverProfileId || null, supervisor_approved_at: new Date().toISOString() })
            .eq('id', requestId);
        if (error) throw error;
    },

    async rejectOtRequest(requestId, rejectionReason) {
        const { error } = await supabaseClient
            .from('ot_requests')
            .update({ status: 'rejected', rejection_reason: rejectionReason || null })
            .eq('id', requestId);
        if (error) throw error;
    },

    // คำขอโอทีที่รอ admin/payroll ตรวจสอบ (fallback ไม่มีหัวหน้างาน + คำขอที่เกินเพดาน 36hr/สัปดาห์
    // หรือเพดานเดือนที่หัวหน้างานอนุมัติผ่านมาแล้ว) ใช้ในหน้า Admin Portal
    async getPendingOtAdminReview(companyId) {
        const { data, error } = await supabaseClient
            .from('ot_requests')
            .select('*, employees(full_name, emp_id)')
            .eq('company_id', companyId)
            .in('status', ['pending', 'pending_admin_review'])
            .eq('resolved_approver_role', 'admin')
            .order('created_at', { ascending: true });
        // หมายเหตุ: query นี้ครอบเฉพาะกรณี resolved_approver_role='admin' (fallback ไม่มีหัวหน้างาน)
        // ส่วนคำขอ status='pending_admin_review' (หัวหน้างานอนุมัติแล้วแต่เกินเพดาน) ต้อง query เพิ่มแยก
        if (error) throw error;
        const { data: escalated, error: err2 } = await supabaseClient
            .from('ot_requests')
            .select('*, employees(full_name, emp_id)')
            .eq('company_id', companyId)
            .eq('status', 'pending_admin_review')
            .order('created_at', { ascending: true });
        if (err2) throw err2;
        const merged = [...(data || []), ...(escalated || [])];
        const seen = new Set();
        return merged.filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    },

    async adminApproveOtRequest(requestId) {
        const { error } = await supabaseClient
            .from('ot_requests')
            .update({ status: 'approved', admin_reviewed_at: new Date().toISOString() })
            .eq('id', requestId);
        if (error) throw error;
    },

    async adminRejectOtRequest(requestId, rejectionReason) {
        const { error } = await supabaseClient
            .from('ot_requests')
            .update({ status: 'rejected', rejection_reason: rejectionReason || null, admin_reviewed_at: new Date().toISOString() })
            .eq('id', requestId);
        if (error) throw error;
    }
};

window.EmployeeSelfService = EmployeeSelfService;
