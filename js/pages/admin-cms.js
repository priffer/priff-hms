// ไฟล์: js/pages/admin-cms.js

const CURRENT_COMPANY_ID = localStorage.getItem('current_company_id') || 'comp_kc_clean';
let currentLogoUrl = null;

async function loadCmsSettings() {
    try {
        // เรียกใช้ Service ดึงข้อมูล
        const data = await CmsService.getSettings(CURRENT_COMPANY_ID);

        if (data) {
            document.getElementById('cmsCompanyName').value = data.company_name || '';
            document.getElementById('cmsHeadline').value = data.hero_headline || '';
            document.getElementById('cmsSubhead').value = data.hero_subhead || '';
            
            currentLogoUrl = data.logo_url || null;
            if (currentLogoUrl) {
                document.getElementById('logoPreview').innerHTML = `<img src="${currentLogoUrl}?v=${Date.now()}" class="w-full h-full object-contain">`;
            } else {
                document.getElementById('logoPreview').innerHTML = `<span class="text-[10px] text-slate-400 font-bold px-1 text-center">ยังไม่มีโลโก้</span>`;
            }
            
            const welfares = data.welfares || [];
            const container = document.getElementById('welfareContainer');
            container.innerHTML = '';
            welfares.forEach(w => addWelfareInput(w));
        } else {
            addWelfareInput('ประกันสังคม');
        }
    } catch (err) {
        console.error('Error loading CMS settings:', err);
    }
}

function addWelfareInput(value = '') {
    const container = document.getElementById('welfareContainer');
    const div = document.createElement('div');
    div.className = 'flex gap-2 items-center';
    div.innerHTML = `
        <span class="shrink-0 text-base">🎁</span>
        <input type="text" value="${value}" class="w-full rounded-xl border border-[#e6edf7] p-2.5 outline-none focus:border-kcblue focus:ring-4 focus:ring-[#eef5ff] welfare-item text-sm bg-white transition-all">
        <button onclick="this.parentElement.remove()" class="shrink-0 rounded-xl bg-red-50 text-red-600 border border-red-100 w-9 h-9 font-bold hover:bg-red-600 hover:text-white transition-colors cursor-pointer">✕</button>
    `;
    container.appendChild(div);
}

async function saveCmsSettings() {
    const company_name = document.getElementById('cmsCompanyName').value;
    const hero_headline = document.getElementById('cmsHeadline').value;
    const hero_subhead = document.getElementById('cmsSubhead').value;
    const logoFile = document.getElementById('cmsLogo').files[0];
    
    const welfareInputs = document.querySelectorAll('.welfare-item');
    const welfares = Array.from(welfareInputs).map(input => input.value).filter(val => val.trim() !== '');

    const btn = document.querySelector('button[onclick="saveCmsSettings()"]');
    const originalText = btn.innerText;
    btn.innerText = 'กำลังบันทึก...';
    btn.disabled = true;

    try {
        let logo_url = null;

        if (logoFile) {
            const fileExt = logoFile.name.split('.').pop();
            const fileName = `companies/${CURRENT_COMPANY_ID}/company-logo.${fileExt}`;
            
            // เรียกใช้ Service อัปโหลดและขอ URL
            await CmsService.uploadLogo(logoFile, fileName);
            logo_url = CmsService.getLogoPublicUrl(fileName);
        }

        const payload = { 
            company_id: CURRENT_COMPANY_ID, 
            company_name, 
            hero_headline, 
            hero_subhead, 
            welfares,
            logo_url: logo_url || currentLogoUrl
        };

        // เรียกใช้ Service บันทึกข้อมูล
        await CmsService.saveSettings(payload);
        
        document.getElementById('cmsLogo').value = '';
        const fileNameEl = document.getElementById('cmsLogoFileName');
        if (fileNameEl) fileNameEl.textContent = 'ไม่ได้เลือกไฟล์ใหม่ (ใช้โลโก้เดิม)';
        alert('บันทึกข้อมูลหน้าเว็บสำเร็จ');
        loadCmsSettings();
    } catch (err) {
        alert('เกิดข้อผิดพลาดในการบันทึก: ' + err.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// Event Listener พรีวิวรูปภาพ + แสดงชื่อไฟล์ที่เลือก
document.getElementById('cmsLogo').addEventListener('change', function(e) {
    const file = e.target.files[0];
    const fileNameEl = document.getElementById('cmsLogoFileName');
    if (file) {
        const objectUrl = URL.createObjectURL(file);
        document.getElementById('logoPreview').innerHTML = `<img src="${objectUrl}" class="w-full h-full object-contain">`;
        if (fileNameEl) fileNameEl.textContent = file.name;
    }
});