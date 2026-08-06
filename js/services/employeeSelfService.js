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
