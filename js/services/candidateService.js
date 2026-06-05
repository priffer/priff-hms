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
    }
};