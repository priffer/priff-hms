async function loadSiteSettings() {
    try {
        const data = await CmsService.getSettings(CURRENT_SITE_COMPANY_ID);
        if (!data) return;

        if (data.company_name) document.getElementById('dynamicCompanyName').innerText = data.company_name;

        if (data.logo_url) {
            const logoContainer = document.getElementById('defaultLogo');
            logoContainer.className = "w-10 h-10 flex items-center justify-center shrink-0 bg-transparent";
            logoContainer.innerHTML = `<img src="${data.logo_url}?v=${Date.now()}" alt="Logo" class="w-full h-full object-contain">`;
        }

        if (data.hero_headline) document.getElementById('mainHeadline').innerText = data.hero_headline;
        if (data.hero_subhead) document.getElementById('subHeadline').innerText = data.hero_subhead;

        const welfareList = document.getElementById('welfareList');
        welfareList.innerHTML = '';
        if (data.welfares && data.welfares.length > 0) {
            data.welfares.forEach(welfare => {
                const li = document.createElement('li');
                li.className = 'flex items-start gap-2';
                li.innerHTML = `✔️ <span class="text-gray-700 font-bold">${welfare}</span>`;
                welfareList.appendChild(li);
            });
        } else {
            welfareList.innerHTML = '<li class="text-gray-400 font-bold">ไม่มีข้อมูลสวัสดิการ</li>';
        }
    } catch (err) {
        console.error('Error loading site settings:', err);
    }
}