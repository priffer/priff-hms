// js/services/announcementService.js
// บริการประกาศบริษัท + ปฏิทินวันหยุด (company_holidays / client_holidays)
// ใช้ร่วมกันทั้งฝั่ง Admin (CRUD เต็ม, RLS role admin/payroll) และฝั่ง ESS (อ่านอย่างเดียว)

const AnnouncementService = {
    getCompanyId() {
        return localStorage.getItem('current_company_id') || 'comp_kc_clean';
    },

    // ---------- Announcements ----------
    // ฝั่งพนักงาน: ดึงเฉพาะประกาศที่เผยแพร่แล้วและตรงกับ role ของตน (RLS กรองซ้ำอีกชั้นที่ DB)
    async getPublishedAnnouncements(limit = 20) {
        const nowIso = new Date().toISOString();
        const { data, error } = await supabaseClient
            .from('announcements')
            .select('*')
            .eq('company_id', this.getCompanyId())
            .not('published_at', 'is', null)
            .lte('published_at', nowIso)
            .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
            .order('is_pinned', { ascending: false })
            .order('published_at', { ascending: false })
            .limit(limit);
        if (error) throw error;
        return data;
    },

    // ฝั่งแอดมิน: ดึงทั้งหมดรวม draft เพื่อจัดการ
    async getAllAnnouncements() {
        const { data, error } = await supabaseClient
            .from('announcements')
            .select('*')
            .eq('company_id', this.getCompanyId())
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async createAnnouncement(payload) {
        payload.company_id = this.getCompanyId();
        const { error } = await supabaseClient.from('announcements').insert([payload]);
        if (error) throw error;
    },

    async updateAnnouncement(id, payload) {
        const { error } = await supabaseClient
            .from('announcements')
            .update(payload)
            .eq('id', id)
            .eq('company_id', this.getCompanyId());
        if (error) throw error;
    },

    async deleteAnnouncement(id) {
        const { error } = await supabaseClient
            .from('announcements')
            .delete()
            .eq('id', id)
            .eq('company_id', this.getCompanyId());
        if (error) throw error;
    },

    async uploadAttachment(file, fileName) {
        const { error } = await supabaseClient.storage
            .from('announcement_attachments')
            .upload(fileName, file, { upsert: true });
        if (error) throw error;
    },

    getAttachmentPublicUrl(fileName) {
        const { data } = supabaseClient.storage.from('announcement_attachments').getPublicUrl(fileName);
        return data.publicUrl;
    },

    // ---------- Company holidays ----------
    async getUpcomingCompanyHolidays(fromDate = new Date().toISOString().split('T')[0], limit = 10) {
        const { data, error } = await supabaseClient
            .from('company_holidays')
            .select('*')
            .eq('company_id', this.getCompanyId())
            .gte('holiday_date', fromDate)
            .order('holiday_date', { ascending: true })
            .limit(limit);
        if (error) throw error;
        return data;
    },

    async getAllCompanyHolidays() {
        const { data, error } = await supabaseClient
            .from('company_holidays')
            .select('*')
            .eq('company_id', this.getCompanyId())
            .order('holiday_date', { ascending: true });
        if (error) throw error;
        return data;
    },

    async createCompanyHoliday(payload) {
        payload.company_id = this.getCompanyId();
        const { error } = await supabaseClient.from('company_holidays').insert([payload]);
        if (error) throw error;
    },

    async deleteCompanyHoliday(id) {
        const { error } = await supabaseClient
            .from('company_holidays')
            .delete()
            .eq('id', id)
            .eq('company_id', this.getCompanyId());
        if (error) throw error;
    },

    // ---------- Client (site-specific) holidays ----------
    async getUpcomingClientHolidays(clientId, fromDate = new Date().toISOString().split('T')[0], limit = 10) {
        let query = supabaseClient
            .from('client_holidays')
            .select('*, clients(client_name)')
            .eq('company_id', this.getCompanyId())
            .gte('holiday_date', fromDate)
            .order('holiday_date', { ascending: true })
            .limit(limit);
        if (clientId) query = query.eq('client_id', clientId);
        const { data, error } = await query;
        if (error) throw error;
        return data;
    },

    async getAllClientHolidays() {
        const { data, error } = await supabaseClient
            .from('client_holidays')
            .select('*, clients(client_name)')
            .eq('company_id', this.getCompanyId())
            .order('holiday_date', { ascending: true });
        if (error) throw error;
        return data;
    },

    async createClientHoliday(payload) {
        payload.company_id = this.getCompanyId();
        const { error } = await supabaseClient.from('client_holidays').insert([payload]);
        if (error) throw error;
    },

    async deleteClientHoliday(id) {
        const { error } = await supabaseClient
            .from('client_holidays')
            .delete()
            .eq('id', id)
            .eq('company_id', this.getCompanyId());
        if (error) throw error;
    }
};

window.AnnouncementService = AnnouncementService;
