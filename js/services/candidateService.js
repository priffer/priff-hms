const CandidateService = {
    // โหลดข้อความ PDPA
    async getPdpaContent() {
        const { data, error } = await supabaseClient
            .from('system_settings')
            .select('setting_value')
            .eq('setting_key', 'PDPA_CONTENT')
            .single();
        if (error) throw error;
        return data;
    },

    // อัปโหลดเอกสารผู้สมัครแบบครอบจักรวาล (รูป, บัตร, วุฒิ ฯลฯ)
    async uploadCandidateFile(file, fileName) {
        const { error } = await supabaseClient.storage
            .from('recruitment_files')
            .upload(fileName, file, { upsert: true });
        if (error) throw error;
    },

    // ขอ URL เอกสาร
    getFilePublicUrl(fileName) {
        const { data } = supabaseClient.storage
            .from('recruitment_files')
            .getPublicUrl(fileName);
        return data.publicUrl;
    },

    // ส่งใบสมัครเข้าตาราง employees
    async submitApplication(payload) {
        const { error } = await supabaseClient
            .from('employees')
            .insert([payload]);
        if (error) throw error;
    }
};