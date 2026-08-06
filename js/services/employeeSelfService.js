// js/services/employeeSelfService.js
// บริการฝั่งพนักงาน (ESS Self-Service): เบิกเงินล่วงหน้า, ลางาน, สลิปเงินเดือน, ประวัติลงเวลา
// ทุกฟังก์ชันพึ่งพา RLS policies (database/06_leave_management.sql, database/07_advance_payments_rls.sql)
// เพื่อจำกัดให้พนักงานเห็น/แก้ไขได้เฉพาะข้อมูลของตัวเองเท่านั้น ไม่ได้กรองด้วย client-side logic

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

    // สรุปยอดวันลาคงเหลือของพนักงาน แยกตามประเภทลา สำหรับปีปัจจุบัน (ปีตามปฏิทิน)
    // คำนวณสดจากข้อมูลจริงเสมอ (ไม่พึ่ง leave_balances.used_days ซึ่งไม่มีโค้ดส่วนไหน
    // เขียนอัปเดตอยู่ในปัจจุบัน - ถ้าอ่านตรงๆ จะโชว์ "ใช้ไป 0 วัน" ผิดตลอด):
    //   entitled = leave_balances.entitled_days ถ้ามีแถว override ไว้ (อนาคต) ไม่งั้น fallback
    //              เป็น leave_types.max_days_per_year (โควตากลางต่อบริษัท)
    //   used     = ผลรวม total_days ของคำขอที่ status='approved' และ start_date อยู่ในปีนี้
    //   remaining = entitled - used (null = ไม่จำกัดวัน เช่น ลาไม่รับค่าจ้าง)
    async getMyLeaveBalanceSummary(employeeId, empId) {
        const year = new Date().getFullYear();
        const yearStart = `${year}-01-01`;
        const yearEnd = `${year}-12-31`;

        const [typesRes, balancesRes, requestsRes] = await Promise.all([
            supabaseClient.from('leave_types').select('*').eq('is_active', true).order('code', { ascending: true }),
            supabaseClient.from('leave_balances').select('leave_type_id, entitled_days').eq('employee_id', employeeId).eq('year', year),
            supabaseClient.from('leave_requests').select('leave_type_id, total_days')
                .eq('emp_id', empId).eq('status', 'approved')
                .gte('start_date', yearStart).lte('start_date', yearEnd)
        ]);
        if (typesRes.error) throw typesRes.error;
        if (balancesRes.error) throw balancesRes.error;
        if (requestsRes.error) throw requestsRes.error;

        const overrideMap = {};
        (balancesRes.data || []).forEach(b => { overrideMap[b.leave_type_id] = b.entitled_days; });

        const usedMap = {};
        (requestsRes.data || []).forEach(r => {
            usedMap[r.leave_type_id] = (usedMap[r.leave_type_id] || 0) + Number(r.total_days);
        });

        return (typesRes.data || []).map(type => {
            const entitled = overrideMap[type.id] !== undefined ? Number(overrideMap[type.id]) : (type.max_days_per_year !== null ? Number(type.max_days_per_year) : null);
            const used = usedMap[type.id] || 0;
            return {
                leaveTypeId: type.id,
                code: type.code,
                nameTh: type.name_th,
                isPaid: type.is_paid,
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

    async createLeaveRequest({ empId, employeeId, companyId, leaveTypeId, startDate, endDate, totalDays, reason }) {
        const payload = {
            emp_id: empId,
            employee_id: employeeId,
            company_id: companyId,
            leave_type_id: leaveTypeId,
            start_date: startDate,
            end_date: endDate,
            total_days: totalDays,
            reason: reason || null,
            status: 'pending'
        };
        const { error } = await supabaseClient.from('leave_requests').insert([payload]);
        if (error) throw error;
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
    }
};

window.EmployeeSelfService = EmployeeSelfService;
