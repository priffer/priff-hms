const CandidateService = {
    getCompanyId() {
        return localStorage.getItem('current_company_id') || 'comp_kc_clean';
    },

    async getPdpaContent() {
        const { data, error } = await supabaseClient
            .from('system_settings')
            .select('setting_value')
            .eq('setting_key', 'PDPA_CONTENT')
            .single();
        if (error) throw error;
        return data;
    },

    async uploadCandidateFile(file, fileName) {
        const { error } = await supabaseClient.storage
            .from('recruitment_files')
            .upload(fileName, file, { upsert: true });
        if (error) throw error;
    },

    getFilePublicUrl(fileName) {
        const { data } = supabaseClient.storage
            .from('recruitment_files')
            .getPublicUrl(fileName);
        return data.publicUrl;
    },

    async submitApplication(payload) {
        payload.company_id = this.getCompanyId();
        const { error } = await supabaseClient
            .from('employees')
            .insert([payload]);
        if (error) throw error;
    },

    async getCandidatesByStatus(status) {
        const { data, error } = await supabaseClient
            .from('employees')
            .select('*')
            .eq('status', status)
            .eq('company_id', this.getCompanyId())
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async getCandidateById(id) {
        const { data, error } = await supabaseClient
            .from('employees')
            .select('*')
            .eq('id', id)
            .eq('company_id', this.getCompanyId())
            .single();
        if (error) throw error;
        return data;
    },

    async updateCandidateData(id, payload) {
        const { error } = await supabaseClient
            .from('employees')
            .update(payload)
            .eq('id', id)
            .eq('company_id', this.getCompanyId());
        if (error) throw error;
    },

    async getActiveEmployees(searchQuery = '') {
        let query = supabaseClient
            .from('employees')
            .select('*')
            .eq('status', 'hired')
            .eq('company_id', this.getCompanyId())
            .order('emp_id', { ascending: true });

        if (searchQuery) {
            query = query.or(`full_name.ilike.%${searchQuery}%,emp_id.ilike.%${searchQuery}%`);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data;
    },

    async getAdvancePayments(empId) {
        const { data, error } = await supabaseClient
            .from('advance_payments')
            .select('*')
            .eq('emp_id', empId)
            .eq('company_id', this.getCompanyId())
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async createAdvancePayment(payload) {
        payload.company_id = this.getCompanyId();
        const { error } = await supabaseClient
            .from('advance_payments')
            .insert([payload]);
        if (error) throw error;
    },

    async updateAdvancePayment(id, payload) {
        const { error } = await supabaseClient
            .from('advance_payments')
            .update(payload)
            .eq('id', id)
            .eq('company_id', this.getCompanyId());
        if (error) throw error;
    },

    async uploadSlipAndGetUrl(file, fileName) {
        const { error } = await supabaseClient.storage
            .from('public-assets')
            .upload(fileName, file, { upsert: true });
        if (error) throw error;
        
        const { data } = supabaseClient.storage
            .from('public-assets')
            .getPublicUrl(fileName);
        return data.publicUrl;
    },

    async getDepartmentsWithHeadcount() {
        const companyId = this.getCompanyId();
        const { data: depts, error: deptError } = await supabaseClient
            .from('departments')
            .select('*')
            .eq('company_id', companyId)
            .order('created_at', { ascending: true });
            
        if (deptError) throw deptError;

        // 🌟 แก้ไขให้นับคนจากคอลัมน์ department_id แทนตัวหนังสือแบบเก่า
        const { data: emps, error: empError } = await supabaseClient
            .from('employees')
            .select('department_id')
            .eq('company_id', companyId)
            .eq('status', 'hired');

        if (empError) throw empError;

        const headcountMap = {};
        emps.forEach(emp => {
            const deptId = emp.department_id;
            if (deptId) {
                headcountMap[deptId] = (headcountMap[deptId] || 0) + 1;
            }
        });

        return depts.map(d => ({
            ...d,
            headcount: headcountMap[d.id] || 0
        }));
    },

    async createDepartment(payload) {
        payload.company_id = this.getCompanyId();
        const { error } = await supabaseClient
            .from('departments')
            .insert([payload]);
        if (error) throw error;
    },

    async updateDepartment(id, payload) {
        const { error } = await supabaseClient
            .from('departments')
            .update(payload)
            .eq('id', id)
            .eq('company_id', this.getCompanyId());
        if (error) throw error;
    },

    async deleteDepartment(id) {
        const { error } = await supabaseClient
            .from('departments')
            .delete()
            .eq('id', id)
            .eq('company_id', this.getCompanyId());
        if (error) throw error;
    },

    // ---------- ผูกไซต์ลูกค้าประจำ (สำหรับปฏิทินวันหยุดฝั่งพนักงานปฏิบัติการ) ----------
    async getClientSites() {
        const { data, error } = await supabaseClient
            .from('clients')
            .select('id, client_name')
            .order('client_name', { ascending: true });
        if (error) throw error;
        return data;
    },

    // คืน user_profiles ของพนักงานคนนี้ (ถ้ายังไม่เคยมีบัญชี ESS จะคืน null แทน error)
    async getUserProfileByEmployeeId(employeeId) {
        const { data, error } = await supabaseClient
            .from('user_profiles')
            .select('id, role, primary_client_id, employee_id')
            .eq('employee_id', employeeId)
            .eq('company_id', this.getCompanyId())
            .maybeSingle();
        if (error) throw error;
        return data;
    },

    async updatePrimaryClientSite(userProfileId, clientId) {
        const { error } = await supabaseClient
            .from('user_profiles')
            .update({ primary_client_id: clientId || null })
            .eq('id', userProfileId)
            .eq('company_id', this.getCompanyId());
        if (error) throw error;
    },

    async getSupervisorAssignedClientIds(userProfileId) {
        const { data, error } = await supabaseClient
            .from('supervisor_client_assignments')
            .select('client_id')
            .eq('user_profile_id', userProfileId);
        if (error) throw error;
        return (data || []).map(r => r.client_id);
    },

    // แทนที่รายการไซต์ที่ supervisor คนนี้ดูแลทั้งหมดด้วยรายการใหม่ (ลบของเดิมทิ้งก่อนเพิ่มใหม่)
    async setSupervisorClientAssignments(userProfileId, clientIds) {
        const companyId = this.getCompanyId();
        const { error: delErr } = await supabaseClient
            .from('supervisor_client_assignments')
            .delete()
            .eq('user_profile_id', userProfileId);
        if (delErr) throw delErr;

        if (clientIds && clientIds.length > 0) {
            const rows = clientIds.map(clientId => ({ user_profile_id: userProfileId, client_id: clientId, company_id: companyId }));
            const { error: insErr } = await supabaseClient
                .from('supervisor_client_assignments')
                .insert(rows);
            if (insErr) throw insErr;
        }
    },

    // ---------- กะการทำงาน (สำหรับตรวจจับมาสาย/ครึ่งวัน/ทำงานเกินกะ) ----------
    // คืนกะที่ "กำลังใช้งานอยู่" ของพนักงานคนนี้ (effective_to IS NULL) ถ้าไม่มีคืน null
    async getCurrentShiftAssignment(employeeId) {
        const { data, error } = await supabaseClient
            .from('employee_shift_assignments')
            .select('*')
            .eq('employee_id', employeeId)
            .is('effective_to', null)
            .maybeSingle();
        if (error) throw error;
        return data;
    },

    async getShiftAssignmentHistory(employeeId) {
        const { data, error } = await supabaseClient
            .from('employee_shift_assignments')
            .select('*')
            .eq('employee_id', employeeId)
            .order('effective_from', { ascending: false });
        if (error) throw error;
        return data;
    },

    // ตั้งกะใหม่ให้พนักงาน: ปิดกะเก่า (effective_to = เมื่อวาน) แล้วเปิดกะใหม่ (effective_from = วันนี้)
    // เก็บประวัติกะเก่าไว้เสมอ ไม่ลบทิ้ง เพื่อให้ข้อมูล attendance ย้อนหลังยังอ้างอิงกะที่ถูกต้องตามช่วงเวลานั้นได้
    async setEmployeeShift(employeeId, { shiftName, shiftStart, shiftEnd, standardHours }) {
        const companyId = this.getCompanyId();
        const today = new Date().toISOString().split('T')[0];
        const current = await this.getCurrentShiftAssignment(employeeId);
        if (current) {
            const y = new Date(); y.setDate(y.getDate() - 1);
            const yesterday = y.toISOString().split('T')[0];
            const { error: closeErr } = await supabaseClient
                .from('employee_shift_assignments')
                .update({ effective_to: yesterday })
                .eq('id', current.id);
            if (closeErr) throw closeErr;
        }
        const { error: insErr } = await supabaseClient
            .from('employee_shift_assignments')
            .insert([{
                company_id: companyId,
                employee_id: employeeId,
                shift_name: shiftName || null,
                shift_start: shiftStart,
                shift_end: shiftEnd,
                standard_hours: standardHours,
                effective_from: today
            }]);
        if (insErr) throw insErr;
    }
};