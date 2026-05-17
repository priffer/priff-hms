const JobService = {
    async getJobsByCompany(companyId) {
        const { data, error } = await supabaseClient
            .from('jobs')
            .select('*')
            .eq('company_id', companyId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async getJobById(id, companyId) {
        const { data, error } = await supabaseClient
            .from('jobs')
            .select('*')
            .eq('id', id)
            .eq('company_id', companyId)
            .single();
        if (error) throw error;
        return data;
    },

    async saveJob(payload, id = null, companyId) {
        if (id) {
            const { error } = await supabaseClient
                .from('jobs')
                .update(payload)
                .eq('id', id)
                .eq('company_id', companyId);
            if (error) throw error;
        } else {
            payload.company_id = companyId;
            payload.is_active = true;
            const { error } = await supabaseClient
                .from('jobs')
                .insert([payload]);
            if (error) throw error;
        }
    },

    async deleteJob(id, companyId) {
        const { error } = await supabaseClient
            .from('jobs')
            .delete()
            .eq('id', id)
            .eq('company_id', companyId);
        if (error) throw error;
    },

    async toggleStatus(id, isActive, companyId) {
        const { error } = await supabaseClient
            .from('jobs')
            .update({ is_active: isActive })
            .eq('id', id)
            .eq('company_id', companyId);
        if (error) throw error;
    },

    async getActiveJobs(companyId) {
        const { data, error } = await supabaseClient
            .from('jobs')
            .select('*')
            .eq('is_active', true)
            .eq('company_id', companyId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    }
};

