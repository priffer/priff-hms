// ไฟล์: js/services/cmsService.js

const CmsService = {
    // ดึงข้อมูลการตั้งค่าหน้าเว็บตามรหัสบริษัท
    async getSettings(companyId) {
        const { data, error } = await supabaseClient
            .from('site_settings')
            .select('*')
            .eq('company_id', companyId)
            .single();
            
        // มองข้าม Error กรณีที่เพิ่งสร้างบริษัทใหม่แล้วยังไม่มีข้อมูล
        if (error && error.code !== 'PGRST116') throw error;
        return data;
    },

    // อัปโหลดไฟล์โลโก้เข้า Storage
    async uploadLogo(file, fileName) {
        const { error } = await supabaseClient.storage
            .from('public-assets')
            .upload(fileName, file, { upsert: true });
            
        if (error) throw error;
    },

    // ขอ URL แบบ Public เพื่อเอามาแสดงผลบนเว็บ
    getLogoPublicUrl(fileName) {
        const { data } = supabaseClient.storage
            .from('public-assets')
            .getPublicUrl(fileName);
            
        return data.publicUrl;
    },

    // บันทึก หรือ อัปเดต ข้อมูลหน้าเว็บ
    async saveSettings(payload) {
        const { error } = await supabaseClient
            .from('site_settings')
            .upsert(payload);
            
        if (error) throw error;
    }
};