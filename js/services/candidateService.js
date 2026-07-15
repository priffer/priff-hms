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
    }
};