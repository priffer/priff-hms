document.addEventListener('DOMContentLoaded', () => {
    loadSiteSettings();
    fetchActiveJobs();
    initializeSearchMode();
    if (typeof initLocationFilters === 'function') {
        initLocationFilters();
    }
});

function initializeSearchMode() {
    const searchMode = localStorage.getItem('searchMode') || 'quick';
    switchSearchMode(searchMode);
}

async function fetchActiveJobs() {
    const grid = document.getElementById('jobGrid');
    if (grid) {
        grid.innerHTML = '<div class="col-span-full text-center p-8 text-gray-500 font-bold">กำลังค้นหาตำแหน่งงานเปิดรับ...</div>';
    }

    try {
        const data = await JobService.getActiveJobs(CURRENT_SITE_COMPANY_ID);
        allJobs = Array.isArray(data) ? data : [];
        filteredJobs = [...allJobs];
        syncLandingOverview();
        renderJobGrid();
    } catch (err) {
        console.error('Error loading jobs:', err);
        if (grid) {
            grid.innerHTML = '<div class="col-span-full text-center p-8 text-red-500 font-bold">ไม่สามารถดึงข้อมูลตำแหน่งงานได้</div>';
        }
        setText('featuredJobsSummary', 'โหลดไม่สำเร็จ');
        renderPopularAreas([]);
        renderFeaturedJobs([]);
        updateHeroMetrics([]);
        updateJobCount(0);
    }
}

function syncLandingOverview() {
    updateHeroMetrics(allJobs);
    renderPopularAreas(allJobs);
    renderFeaturedJobs(allJobs);
}

function renderJobGrid() {
    const grid = document.getElementById('jobGrid');
    if (!grid) return;

    updateJobCount(filteredJobs.length);
    grid.innerHTML = '';

    if (filteredJobs.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center p-12 bg-white border border-slate-200 rounded-3xl text-slate-500 font-bold">ไม่พบตำแหน่งงาน</div>';
        const pagination = document.getElementById('paginationControls');
        if (pagination) pagination.innerHTML = '';
        return;
    }

    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedItems = filteredJobs.slice(startIndex, startIndex + itemsPerPage);

    paginatedItems.forEach(job => {
        const companyName = job.company_name || getElementText('dynamicCompanyName', 'KC Clean Trade');
        const jobType = job.job_type || job.position_type || job.hiring_type || 'งานประจำ';
        const locationSummary = getJobLocationSummary(job.zone_name);
        const salaryText = job.salary_text || 'ตามตกลง';
        const audienceLabel = getJobAudienceLabel(job);

        grid.innerHTML += `
            <article class="group relative overflow-hidden bg-white border border-slate-200 rounded-[2rem] p-5 lg:p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-200 flex flex-col justify-between gap-5">
                <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-kcblue via-[#0b4b86] to-kcyellow"></div>
                <div class="space-y-4">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0 space-y-3">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">${jobType}</span>
                                <span class="inline-flex items-center rounded-full bg-kcyellow/20 px-3 py-1 text-xs font-bold text-kcblue">${audienceLabel}</span>
                            </div>
                            <h3 class="font-extrabold text-slate-900 text-xl lg:text-2xl leading-snug line-clamp-2">${job.title || 'ไม่ระบุชื่อตำแหน่ง'}</h3>
                            <div class="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                                <span class="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 font-bold text-kcblue">${locationSummary.primary}</span>
                                ${locationSummary.secondary ? `<span class="truncate text-slate-500">${locationSummary.secondary}</span>` : `<span class="truncate text-slate-500">${companyName}</span>`}
                            </div>
                        </div>
                    </div>
                    <div class="rounded-[1.5rem] bg-gradient-to-br from-slate-50 to-blue-50 px-4 py-4 border border-slate-100">
                        <p class="text-xs uppercase tracking-[0.25em] text-slate-500">เงินเดือน / รายได้</p>
                        <p class="mt-2 text-2xl font-extrabold text-kcblue">${salaryText}</p>
                        <p class="mt-2 text-sm text-slate-500">แตะดูรายละเอียดงาน</p>
                    </div>
                </div>
                <div class="mt-auto grid gap-3 sm:grid-cols-2">
                    <button onclick="applyForThisJob(${job.id})" class="w-full rounded-[1.25rem] bg-kcblue text-white px-4 py-3.5 text-sm font-bold hover:bg-kcyellow hover:text-kcblue transition-colors shadow-sm">สมัครงาน</button>
                    <button onclick="openJobModal(${job.id})" class="w-full rounded-[1.25rem] border border-slate-300 bg-white text-slate-700 px-4 py-3.5 text-sm font-bold hover:border-kcblue hover:text-kcblue transition-colors">ดูรายละเอียด</button>
                </div>
            </article>
        `;
    });

    renderPaginationControls();
}

function renderPaginationControls() {
    const container = document.getElementById('paginationControls');
    if (!container) return;

    container.innerHTML = '';
    const totalPages = Math.ceil(filteredJobs.length / itemsPerPage);
    if (totalPages <= 1) return;

    for (let i = 1; i <= totalPages; i++) {
        const btn = document.createElement('button');
        btn.innerText = i;
        btn.className = `w-10 h-10 rounded-full font-bold border transition-colors ${currentPage === i ? 'bg-kcblue text-white border-kcblue' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`;
        btn.onclick = () => {
            currentPage = i;
            renderJobGrid();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        container.appendChild(btn);
    }
}

function resetFilters() {
    const searchInput = document.getElementById('searchKeyword');
    const locationInput = document.getElementById('locationKeyword');
    const dd1 = document.getElementById('dd1');
    const dd2 = document.getElementById('dd2');
    const dd3 = document.getElementById('dd3');
    const boxDd2 = document.getElementById('boxDd2');
    const boxDd3 = document.getElementById('boxDd3');

    if (searchInput) searchInput.value = '';
    if (locationInput) locationInput.value = '';
    if (dd1) dd1.value = '';
    if (dd2) dd2.value = '';
    if (dd3) dd3.value = '';
    if (dd2) dd2.innerHTML = '';
    if (dd3) dd3.innerHTML = '';
    if (boxDd2) boxDd2.classList.add('hidden');
    if (boxDd3) boxDd3.classList.add('hidden');
    filterJobs(false);
}

function toggleFilterPanel() {
    const panel = document.getElementById('searchPanel');
    if (!panel) return;

    if (window.innerWidth >= 640) {
        panel.classList.remove('hidden');
        resetFilterPanelStyles(panel);
        return;
    }

    const isOpen = !panel.classList.contains('hidden');
    if (isOpen) {
        panel.classList.add('hidden');
        resetFilterPanelStyles(panel);
        return;
    }

    panel.classList.remove('hidden');
    panel.style.position = 'fixed';
    panel.style.top = '0';
    panel.style.left = '0';
    panel.style.right = '0';
    panel.style.bottom = '0';
    panel.style.width = '100%';
    panel.style.height = '100%';
    panel.style.zIndex = '9999';
    panel.style.backgroundColor = '#ffffff';
    panel.style.overflowY = 'auto';
    panel.style.padding = '1.5rem';
}

function resetFilterPanelStyles(panel) {
    panel.style.position = '';
    panel.style.top = '';
    panel.style.left = '';
    panel.style.right = '';
    panel.style.bottom = '';
    panel.style.width = '';
    panel.style.height = '';
    panel.style.zIndex = '';
    panel.style.backgroundColor = '';
    panel.style.overflowY = '';
    panel.style.padding = '';
}

function updateJobCount(count) {
    setText('jobCount', `${count} ตำแหน่ง`);
}

function updateHeroMetrics(jobs) {
    const areaCount = buildPopularAreas(jobs).length;
    setText('heroOpenJobsCount', String(jobs.length));
    setText('heroAreaCount', String(areaCount));
}

function renderPopularAreas(jobs) {
    const container = document.getElementById('popularAreas');
    if (!container) return;

    const popularAreas = buildPopularAreas(jobs).slice(0, 5);
    if (popularAreas.length === 0) {
        container.innerHTML = '<div class="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-5 py-5 text-sm text-slate-400">ยังไม่มีข้อมูลพื้นที่</div>';
        return;
    }

    container.innerHTML = popularAreas.map(area => `
        <button type="button" onclick="applyPopularAreaFilter('${escapeJsString(area.label)}')" class="group rounded-[1.5rem] border border-slate-200 bg-gradient-to-br from-white to-blue-50/60 p-5 text-left transition-all hover:-translate-y-1 hover:border-kcblue hover:shadow-lg">
            <div class="flex items-start justify-between gap-3">
                <div>
                    <span class="block text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Location</span>
                    <span class="mt-2 block text-xl font-extrabold text-slate-900">${escapeHtml(area.label)}</span>
                </div>
                <span class="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-kcyellow text-kcblue font-black shadow-sm">${area.count}</span>
            </div>
            <span class="mt-4 block text-sm text-slate-500">เปิดรับ ${area.count} ตำแหน่ง</span>
        </button>
    `).join('');
}

function renderFeaturedJobs(jobs) {
    const container = document.getElementById('featuredJobsGrid');
    if (!container) return;

    const featuredJobs = jobs.slice(0, 5);
    setText('featuredJobsSummary', featuredJobs.length > 0 ? `${featuredJobs.length} งาน` : 'ยังไม่มีตำแหน่งแนะนำ');

    if (featuredJobs.length === 0) {
        container.innerHTML = '<div class="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5 text-sm text-slate-400">ยังไม่มีตำแหน่งงานแนะนำ</div>';
        return;
    }

    container.innerHTML = featuredJobs.map(job => `
        <button type="button" onclick="openJobModal(${job.id})" class="group w-full rounded-[1.5rem] border border-slate-200 bg-white p-4 text-left transition-colors hover:border-kcblue hover:bg-slate-50">
            <div class="flex items-start justify-between gap-4">
                <div class="min-w-0 flex-1 space-y-2">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">${escapeHtml(getJobAudienceLabel(job))}</span>
                        <span class="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-kcblue">${escapeHtml(getJobLocationSummary(job.zone_name).primary)}</span>
                    </div>
                    <p class="text-base sm:text-lg font-extrabold text-slate-900 leading-snug line-clamp-2">${escapeHtml(job.title || 'ไม่ระบุชื่อตำแหน่ง')}</p>
                    <p class="text-sm text-slate-500 line-clamp-1">${escapeHtml(job.zone_name || 'ไม่ระบุพื้นที่')}</p>
                </div>
                <div class="shrink-0 text-right">
                    <p class="text-sm font-bold text-kcblue">${escapeHtml(job.salary_text || 'ตามตกลง')}</p>
                    <p class="mt-2 text-xs text-slate-400">ดูรายละเอียด</p>
                </div>
            </div>
        </button>
    `).join('');
}

function buildPopularAreas(jobs) {
    const areas = new Map();

    jobs.forEach(job => {
        const label = getPrimaryArea(job.zone_name);
        if (!label) return;
        areas.set(label, (areas.get(label) || 0) + 1);
    });

    return Array.from(areas.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'th'));
}

function getPrimaryArea(zoneName) {
    if (!zoneName) return '';

    const zoneText = String(zoneName);
    const areaAlias = getAreaAlias(zoneText);
    if (areaAlias) return areaAlias;
    const normalizedZone = normalizeAreaText(zoneText);
    const matchedArea = getAreaKeywords().find(area => normalizedZone.includes(area.normalized));
    if (matchedArea) return matchedArea.label;

    return zoneText
        .split(/[•,/|-]/)[0]
        .replace(/\(.*?\)/g, '')
        .trim();
}

function applyPopularAreaFilter(areaLabel) {
    const searchInput = document.getElementById('searchKeyword');
    if (searchInput) searchInput.value = areaLabel;
    filterJobs();
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.innerText = value;
}

function getElementText(id, fallback = '') {
    const element = document.getElementById(id);
    return element ? element.innerText : fallback;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeJsString(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function getJobLocationSummary(zoneName) {
    const raw = String(zoneName || 'ไม่ระบุพื้นที่').trim();
    const primary = getPrimaryArea(raw) || raw;

    return {
        primary,
        secondary: primary !== raw ? raw : ''
    };
}

function getJobAudienceLabel(job) {
    const title = String(job.title || '').toLowerCase();

    if (/หัวหน้า|supervisor|foreman|leader/.test(title)) return 'หัวหน้างาน';
    if (/warehouse|คลัง|ขนส่ง/.test(title)) return 'คลังสินค้า';
    if (/โรงงาน|ผลิต|แพ็ค|operator|operation/.test(title)) return 'งานปฏิบัติการ';
    if (/แม่บ้าน|ทำความสะอาด|clean/.test(title)) return 'งานทำความสะอาด';

    return 'หน้างาน';
}

function getAreaAlias(zoneName) {
    const normalizedZone = normalizeAreaText(zoneName);
    const aliases = [
        { label: 'ศรีราชา', patterns: ['ศรีราชา', 'เครือสหพัฒน์'] },
        { label: 'แหลมฉบัง', patterns: ['แหลมฉบัง'] },
        { label: 'บ่อวิน', patterns: ['บ่อวิน'] },
        { label: 'ปลวกแดง', patterns: ['ปลวกแดง'] },
        { label: 'บ้านค่าย', patterns: ['บ้านค่าย'] },
        { label: 'นิคมพัฒนา', patterns: ['นิคมพัฒนา'] },
        { label: 'อมตะซิตี้', patterns: ['อมตะซิตี้', 'อมตะ'] },
        { label: 'ปิ่นทอง', patterns: ['ปิ่นทอง'] },
        { label: 'บางปะกง', patterns: ['บางปะกง'] },
        { label: 'พานทอง', patterns: ['พานทอง'] },
        { label: 'พนัสนิคม', patterns: ['พนัสนิคม'] }
    ];

    const matched = aliases.find(alias => alias.patterns.some(pattern => normalizedZone.includes(normalizeAreaText(pattern))));
    return matched ? matched.label : '';
}

let areaKeywordsCache = null;

function getAreaKeywords() {
    if (areaKeywordsCache) return areaKeywordsCache;

    const candidates = [];
    if (typeof locationData !== 'undefined') {
        Object.entries(locationData).forEach(([province, groups]) => {
            candidates.push(province);

            Object.values(groups).forEach(groupValue => {
                if (Array.isArray(groupValue)) {
                    groupValue.forEach(item => candidates.push(item));
                    return;
                }

                Object.entries(groupValue).forEach(([amphoe, tambons]) => {
                    candidates.push(amphoe);
                    tambons.forEach(tambon => candidates.push(tambon));
                });
            });
        });
    }

    areaKeywordsCache = Array.from(new Set(candidates
        .map(cleanAreaLabel)
        .filter(label => label && !['ชลบุรี', 'ระยอง', 'ฉะเชิงเทรา'].includes(label))))
        .map(label => ({ label, normalized: normalizeAreaText(label) }))
        .sort((a, b) => b.normalized.length - a.normalized.length);

    return areaKeywordsCache;
}

function cleanAreaLabel(label) {
    return String(label)
        .replace(/^อ\./, '')
        .replace(/^ต\./, '')
        .replace(/\(ทั้งหมด\)/g, '')
        .replace(/^นิคมอุตสาหกรรม\s*/g, '')
        .replace(/^สวนอุตสาหกรรม\s*/g, '')
        .replace(/^เขตประกอบการอุตสาหกรรม\s*/g, '')
        .replace(/^เขตนวัตกรรม/g, 'เขตนวัตกรรม')
        .trim();
}

function normalizeAreaText(value) {
    return String(value)
        .toLowerCase()
        .replace(/ต\.|อ\.|จ\.|เขต/g, '')
        .replace(/\s+/g, '');
}

function switchSearchMode(mode) {
    const quickForm = document.getElementById('quickSearchForm');
    const detailedForm = document.getElementById('detailedSearchForm');
    const quickBtn = document.getElementById('quickModeBtn');
    const detailedBtn = document.getElementById('detailedModeBtn');

    if (mode === 'quick') {
        if (quickForm) quickForm.classList.remove('hidden');
        if (detailedForm) detailedForm.classList.add('hidden');
        if (quickBtn) {
            quickBtn.classList.add('bg-kcblue', 'text-white', 'border-kcblue');
            quickBtn.classList.remove('bg-white', 'text-slate-700', 'border-slate-200');
        }
        if (detailedBtn) {
            detailedBtn.classList.remove('bg-kcblue', 'text-white', 'border-kcblue');
            detailedBtn.classList.add('bg-white', 'text-slate-700', 'border-slate-200');
        }
    } else if (mode === 'detailed') {
        if (quickForm) quickForm.classList.add('hidden');
        if (detailedForm) detailedForm.classList.remove('hidden');
        if (quickBtn) {
            quickBtn.classList.remove('bg-kcblue', 'text-white', 'border-kcblue');
            quickBtn.classList.add('bg-white', 'text-slate-700', 'border-slate-200');
        }
        if (detailedBtn) {
            detailedBtn.classList.add('bg-kcblue', 'text-white', 'border-kcblue');
            detailedBtn.classList.remove('bg-white', 'text-slate-700', 'border-slate-200');
        }
    }

    localStorage.setItem('searchMode', mode);
}
