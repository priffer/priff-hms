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

    // ---------- ปฏิทินวันหยุดที่ "ใช้ได้จริง" สำหรับผู้ใช้ที่ login อยู่ ----------
    // Logic (อนุมัติจากผู้ใช้แล้ว): ถ้าไซต์ลูกค้ามีปฏิทินของตัวเอง ให้ "แทนที่" ปฏิทินบริษัททั้งหมด
    // (ไม่ใช่บวกรวม) เพราะบางไซต์ให้ทำงานแม้เป็นวันหยุดนักขัตฤกษ์ของบริษัท; ถ้าไซต์ยังไม่ตั้งค่า
    // ปฏิทินของตัวเองเลย ให้ fallback ไปใช้ปฏิทินบริษัทไปก่อน กันไม่ให้ไซต์นั้นดูเหมือนไม่มีวันหยุดเลย
    // profile: user_profiles ของผู้ใช้ปัจจุบัน (ต้องมี id, role, primary_client_id)
    async getMyEffectiveHolidayCalendar(profile, fromDate = new Date().toISOString().split('T')[0], limit = 10) {
        const companyHolidays = await this.getUpcomingCompanyHolidays(fromDate, limit);

        if (!profile) {
            return { scope: 'company', companyHolidays, sites: [] };
        }

        // Supervisor อาจดูแลได้หลายไซต์พร้อมกัน ผ่าน supervisor_client_assignments
        if (profile.role === 'supervisor') {
            const { data: assignments, error } = await supabaseClient
                .from('supervisor_client_assignments')
                .select('client_id, clients(client_name)')
                .eq('user_profile_id', profile.id);
            if (error) throw error;

            if (!assignments || assignments.length === 0) {
                return { scope: 'company', companyHolidays, sites: [] };
            }

            const sites = [];
            for (const a of assignments) {
                const clientHolidays = await this.getUpcomingClientHolidays(a.client_id, fromDate, limit);
                sites.push({
                    clientId: a.client_id,
                    clientName: a.clients?.client_name || 'ไม่ระบุไซต์งาน',
                    holidays: (clientHolidays && clientHolidays.length > 0) ? clientHolidays : null // null = ไซต์นี้ยังไม่ตั้งปฏิทิน -> fallback บริษัท
                });
            }
            return { scope: 'multi-site', companyHolidays, sites };
        }

        // พนักงาน/หัวหน้างานที่ผูกไซต์ประจำไว้ (primary_client_id)
        if (profile.primary_client_id) {
            const clientHolidays = await this.getUpcomingClientHolidays(profile.primary_client_id, fromDate, limit);
            if (clientHolidays && clientHolidays.length > 0) {
                return {
                    scope: 'site',
                    companyHolidays,
                    sites: [{
                        clientId: profile.primary_client_id,
                        clientName: clientHolidays[0].clients?.client_name || 'ไซต์งานของคุณ',
                        holidays: clientHolidays
                    }]
                };
            }
            return { scope: 'company', companyHolidays, sites: [], usingCompanyFallback: true };
        }

        // พนักงานออฟฟิศ / ยังไม่ได้ผูกไซต์ลูกค้า
        return { scope: 'company', companyHolidays, sites: [] };
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

    // คัดลอกวันหยุดบริษัททั้งหมดมาเป็น "ฐานตั้งต้น" ของปฏิทินไซต์ลูกค้า (แล้วแอดมินค่อยลบ/เพิ่มทีหลัง)
    // จำเป็นเพราะ client_holidays ใช้ logic "แทนที่" ปฏิทินบริษัททั้งหมด ไม่ใช่บวกรวม ถ้าไม่มีปุ่มนี้
    // แอดมินต้องพิมพ์วันหยุดทั้งปีใหม่เองทุกครั้งที่ตั้งปฏิทินไซต์ใหม่
    async copyCompanyHolidaysToClient(clientId) {
        const companyHolidays = await this.getAllCompanyHolidays();
        if (!companyHolidays || companyHolidays.length === 0) return { copied: 0, total: 0 };
        const rows = companyHolidays.map(h => ({
            company_id: this.getCompanyId(),
            client_id: clientId,
            holiday_date: h.holiday_date,
            name_th: h.name_th
        }));
        // ignoreDuplicates: true -> ข้ามวันที่ไซต์นี้มีอยู่แล้ว (unique client_id+holiday_date) โดยไม่ error
        const { data, error } = await supabaseClient
            .from('client_holidays')
            .upsert(rows, { onConflict: 'client_id,holiday_date', ignoreDuplicates: true })
            .select();
        if (error) throw error;
        return { copied: (data || []).length, total: rows.length };
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
