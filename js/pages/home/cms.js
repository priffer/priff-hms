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

        renderWelfareCards(data.welfares || []);
    } catch (err) {
        console.error('Error loading site settings:', err);
    }
}

// Picks a fitting emoji + color for each welfare line so the benefits list reads
// like a set of employer-branding badges instead of a plain legal checklist.
function getWelfareIcon(text) {
    const t = String(text || '').toLowerCase();
    const rules = [
        { test: /ประกันสังคม|กองทุนเงินทดแทน|สปส/, emoji: '🛡️', bg: 'bg-blue-500/10' },
        { test: /ประกันสุขภาพ|ประกันชีวิต|อุบัติเหตุ|พยาบาล/, emoji: '❤️‍🩹', bg: 'bg-rose-500/10' },
        { test: /โบนัส|bonus/, emoji: '💰', bg: 'bg-kcyellow/20' },
        { test: /ปรับ|ขึ้นเงินเดือน|เงินเดือน/, emoji: '📈', bg: 'bg-emerald-500/10' },
        { test: /ยูนิฟอร์ม|ชุด|uniform/, emoji: '👕', bg: 'bg-violet-500/10' },
        { test: /วันหยุด|ลาพักร้อน|ลาป่วย|ลากิจ|ลาคลอด/, emoji: '🏖️', bg: 'bg-cyan-500/10' },
        { test: /รถรับส่ง|เดินทาง|shuttle/, emoji: '🚐', bg: 'bg-amber-500/10' },
        { test: /หอพัก|ที่พัก|บ้านพัก/, emoji: '🏠', bg: 'bg-orange-500/10' },
        { test: /อาหาร|โรงอาหาร|ข้าว/, emoji: '🍚', bg: 'bg-lime-500/10' },
        { test: /โอที|ot\b|ล่วงเวลา/, emoji: '⏱️', bg: 'bg-indigo-500/10' },
        { test: /อบรม|ฝึกอบรม|training|พัฒนา/, emoji: '🎓', bg: 'bg-sky-500/10' },
        { test: /เงินกู้|สวัสดิการกู้|เงินช่วยเหลือ/, emoji: '🤝', bg: 'bg-teal-500/10' }
    ];

    const matched = rules.find(rule => rule.test.test(t));
    return matched || { emoji: '✅', bg: 'bg-white/10' };
}

function renderWelfareCards(welfares) {
    const container = document.getElementById('welfareList');
    if (!container) return;

    if (!welfares || welfares.length === 0) {
        container.innerHTML = '<div class="rounded-2xl bg-white/10 border border-white/10 p-4 text-sm text-blue-100/70 sm:col-span-2 lg:col-span-4">ยังไม่มีข้อมูลสวัสดิการ</div>';
        return;
    }

    container.innerHTML = welfares.map(welfare => {
        const icon = getWelfareIcon(welfare);
        const safeText = String(welfare)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `
            <div class="flex items-center gap-3 rounded-2xl bg-white/10 border border-white/10 px-4 py-3.5 backdrop-blur-sm hover:bg-white/15 transition-colors">
                <span class="shrink-0 w-10 h-10 rounded-xl ${icon.bg} flex items-center justify-center text-xl">${icon.emoji}</span>
                <span class="text-sm font-bold text-white leading-snug">${safeText}</span>
            </div>
        `;
    }).join('');
}