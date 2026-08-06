document.addEventListener('DOMContentLoaded', () => {
    loadSiteSettings();
    fetchActiveJobs();
    if (typeof initLocationFilters === 'function') {
        initLocationFilters();
    }
    initFeaturedJobsScroller();
});

// Lets desktop/mouse users scroll the horizontal featured-jobs carousel with the
// vertical mouse wheel (native horizontal-only overflow otherwise ignores wheel input).
function initFeaturedJobsScroller() {
    const el = document.getElementById('featuredJobsGrid');
    if (!el) return;

    el.addEventListener('wheel', (event) => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.preventDefault();
        // Multiply the delta: a regular mouse wheel fires one small, fixed-size
        // "notch" per click (unlike a trackpad's continuous stream), so without
        // this it barely nudges the carousel per scroll.
        el.scrollLeft += event.deltaY * 3;
    }, { passive: false });
}

// Moves the featured-jobs carousel by ~80% of its visible width per click,
// used by the prev/next arrow buttons shown on larger screens.
function scrollFeaturedJobs(direction) {
    const el = document.getElementById('featuredJobsGrid');
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
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

// Builds a context-aware "no results" message: tells the user exactly which combination
// of keyword + location filters produced zero matches, with a one-click way to clear them.
function buildEmptyStateHtml() {
    const kwEl = document.getElementById('searchKeyword');
    const dd1 = document.getElementById('dd1');
    const dd2 = document.getElementById('dd2');
    const dd3 = document.getElementById('dd3');

    const keyword = kwEl ? kwEl.value.trim() : '';
    const locationParts = [dd3 ? dd3.value : '', dd2 ? dd2.value : '', dd1 ? dd1.value : ''].filter(Boolean);

    if (!keyword && locationParts.length === 0) {
        return '<div class="col-span-full text-center p-12 bg-white border border-slate-200 rounded-3xl text-slate-500 font-bold">ไม่พบตำแหน่งงาน</div>';
    }

    let detail = '';
    if (keyword && locationParts.length > 0) {
        detail = `ไม่พบตำแหน่งงานที่ตรงกับคำว่า <strong class="text-slate-700">"${keyword}"</strong> ในพื้นที่ <strong class="text-slate-700">${locationParts.join(' / ')}</strong>`;
    } else if (keyword) {
        detail = `ไม่พบตำแหน่งงานที่ตรงกับคำว่า <strong class="text-slate-700">"${keyword}"</strong>`;
    } else {
        detail = `ไม่พบตำแหน่งงานในพื้นที่ <strong class="text-slate-700">${locationParts.join(' / ')}</strong>`;
    }

    return `
        <div class="col-span-full text-center p-12 bg-white border border-slate-200 rounded-3xl">
            <p class="text-slate-500 font-bold">${detail}</p>
            <p class="text-sm text-slate-400 mt-1">ลองล้างตัวกรองบางส่วน หรือลองใช้คำค้นหาอื่น</p>
            <button type="button" onclick="resetFilters()" class="mt-4 inline-flex items-center rounded-full bg-kcblue text-white text-sm font-bold px-5 py-2.5 hover:bg-kcdark transition-colors">ล้างตัวกรองทั้งหมด</button>
        </div>
    `;
}

function renderJobGrid() {
    const grid = document.getElementById('jobGrid');
    if (!grid) return;

    updateJobCount(filteredJobs.length);
    updateFilterActiveDot();
    grid.innerHTML = '';

    if (filteredJobs.length === 0) {
        grid.innerHTML = buildEmptyStateHtml();
        const pagination = document.getElementById('paginationControls');
        if (pagination) pagination.innerHTML = '';
        return;
    }

    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedItems = filteredJobs.slice(startIndex, startIndex + itemsPerPage);

    paginatedItems.forEach(job => {
        const companyName = job.company_name || getElementText('dynamicCompanyName', 'KC Clean Trade');
        const locationSummary = getJobLocationSummary(job.zone_name);
        const salaryText = job.salary_text || 'ตามตกลง';
        const audienceLabel = getJobAudienceLabel(job);
        const style = getJobCategoryStyle(job);
        const newBadge = isJobNew(job)
            ? `<span class="absolute top-4 right-4 inline-flex items-center gap-1 rounded-full bg-kcyellow px-3 py-1 text-[11px] font-extrabold text-kcdark shadow-sm">🔥 ใหม่</span>`
            : '';

        grid.innerHTML += `
            <article class="group relative overflow-hidden bg-white border border-[#e6edf7] rounded-[2rem] p-5 lg:p-6 shadow-[0_12px_30px_rgba(15,43,115,0.04)] hover:shadow-[0_18px_40px_rgba(15,43,115,0.08)] hover:-translate-y-1 transition-all duration-200 flex flex-col justify-between gap-5">
                <div class="absolute inset-x-0 top-0 h-1.5 ${style.bar}"></div>
                ${newBadge}
                <div class="space-y-4">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0 space-y-3">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="inline-flex items-center justify-center w-9 h-9 rounded-xl ${style.iconBg} text-base">${style.icon}</span>
                                <span class="inline-flex items-center rounded-full ${style.chip} border px-3 py-1 text-xs font-bold">${audienceLabel}</span>
                            </div>
                            <h3 class="font-extrabold text-kcdark text-xl lg:text-2xl leading-snug line-clamp-2">${job.title || 'ไม่ระบุชื่อตำแหน่ง'}</h3>
                            <div class="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                                <span class="inline-flex items-center rounded-full bg-[#eef5ff] px-3 py-1 font-bold text-kcblue">${locationSummary.primary}</span>
                                ${locationSummary.secondary ? `<span class="truncate text-slate-500">${locationSummary.secondary}</span>` : `<span class="truncate text-slate-500">${companyName}</span>`}
                            </div>
                        </div>
                    </div>
                    <div class="rounded-[1.5rem] bg-[#f7faff] px-4 py-4 border border-[#e6edf7]">
                        <p class="text-xs uppercase tracking-[0.25em] text-slate-500">เงินเดือน / รายได้</p>
                        <p class="mt-2 text-2xl font-extrabold text-kcdark">${salaryText}</p>
                        <p class="mt-2 text-sm text-slate-500">แตะดูรายละเอียดงาน</p>
                    </div>
                </div>
                <div class="mt-auto grid gap-3 sm:grid-cols-2">
                    <button onclick="applyForThisJob(${job.id})" class="w-full rounded-[1.25rem] bg-kcblue text-white px-4 py-3.5 text-sm font-bold hover:bg-kcdark transition-colors shadow-sm">สมัครงาน</button>
                    <button onclick="openJobModal(${job.id})" class="w-full rounded-[1.25rem] border border-[#e6edf7] bg-white text-slate-700 px-4 py-3.5 text-sm font-bold hover:border-kcblue hover:text-kcblue hover:bg-[#eef5ff] transition-colors">ดูรายละเอียด</button>
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
        btn.className = `w-10 h-10 rounded-full font-bold border transition-colors ${currentPage === i ? 'bg-kcblue text-white border-kcblue shadow-sm' : 'bg-white text-slate-700 border-[#e6edf7] hover:bg-[#eef5ff] hover:text-kcblue'}`;
        btn.onclick = () => {
            currentPage = i;
            renderJobGrid();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        container.appendChild(btn);
    }
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
        container.innerHTML = '<div class="rounded-[1.5rem] border border-[#e6edf7] bg-white px-5 py-5 text-sm text-slate-400">ยังไม่มีข้อมูลพื้นที่</div>';
        return;
    }

    container.innerHTML = popularAreas.map(area => `
        <button type="button" onclick="applyPopularAreaFilter('${escapeJsString(area.label)}')" class="group rounded-[1.5rem] border border-[#e6edf7] bg-white p-5 text-left transition-all hover:-translate-y-1 hover:border-kcblue hover:shadow-[0_12px_30px_rgba(15,43,115,0.08)]">
            <div class="flex items-start justify-between gap-3">
                <div>
                    <span class="block text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Location</span>
                    <span class="mt-2 block text-xl font-extrabold text-kcdark">${escapeHtml(area.label)}</span>
                </div>
                <span class="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-kclight text-kcdark font-black">${area.count}</span>
            </div>
            <span class="mt-4 block text-sm text-slate-500">เปิดรับ ${area.count} ตำแหน่ง</span>
        </button>
    `).join('');
}

function renderFeaturedJobs(jobs) {
    const container = document.getElementById('featuredJobsGrid');
    if (!container) return;

    const featuredJobs = jobs.slice(0, 8);
    setText('featuredJobsSummary', featuredJobs.length > 0 ? `${featuredJobs.length} งาน` : 'ยังไม่มีตำแหน่งแนะนำ');

    if (featuredJobs.length === 0) {
        container.innerHTML = '<div class="rounded-[1.5rem] border border-[#e6edf7] bg-white p-5 text-sm text-slate-400">ยังไม่มีตำแหน่งงานแนะนำ</div>';
        return;
    }

    container.innerHTML = featuredJobs.map(job => {
        const style = getJobCategoryStyle(job);
        const newBadge = isJobNew(job)
            ? `<span class="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-kcyellow px-2.5 py-1 text-[10px] font-extrabold text-kcdark shadow-sm">🔥 ใหม่</span>`
            : '';

        return `
        <button type="button" onclick="openJobModal(${job.id})" class="group relative overflow-hidden shrink-0 snap-start w-[250px] sm:w-[280px] rounded-[1.75rem] border border-[#e6edf7] bg-white p-4 sm:p-5 text-left transition-all hover:-translate-y-1 hover:shadow-[0_16px_36px_rgba(15,43,115,0.1)]">
            <div class="absolute inset-x-0 top-0 h-1.5 ${style.bar}"></div>
            ${newBadge}
            <div class="flex items-center gap-2.5 mb-3">
                <span class="w-10 h-10 shrink-0 rounded-2xl ${style.iconBg} flex items-center justify-center text-lg">${style.icon}</span>
                <span class="inline-flex items-center rounded-full bg-kclight px-3 py-1 text-xs font-bold text-kcdark truncate">${escapeHtml(getJobLocationSummary(job.zone_name).primary)}</span>
            </div>
            <p class="text-base font-extrabold text-kcdark leading-snug line-clamp-2 group-hover:text-kcblue transition-colors">${escapeHtml(job.title || 'ไม่ระบุชื่อตำแหน่ง')}</p>
            <p class="mt-1 text-sm text-slate-500 line-clamp-1">${escapeHtml(job.zone_name || 'ไม่ระบุพื้นที่')}</p>
            <div class="mt-4 flex items-center justify-between gap-2">
                <p class="text-sm font-extrabold text-kcblue truncate">${escapeHtml(job.salary_text || 'ตามตกลง')}</p>
                <span class="shrink-0 text-xs text-slate-400">ดูเพิ่ม →</span>
            </div>
        </button>
        `;
    }).join('');
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
    toggleClearKeywordBtn();

    // Clicking a popular-area card is a keyword search shortcut - clear any stale
    // location dropdown selection so it doesn't silently conflict (same as submitKeywordSearch()).
    const dd1 = document.getElementById('dd1');
    const dd2 = document.getElementById('dd2');
    const dd3 = document.getElementById('dd3');
    if (dd1) dd1.value = '';
    if (typeof resetDropdown === 'function') {
        resetDropdown(dd2, 'โปรดเลือกจังหวัดก่อน');
        resetDropdown(dd3, 'โปรดเลือกอำเภอก่อน');
    }

    filterJobs();
    updateFilterActiveDot();
    renderActiveChips();
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

// Maps each job "category" (derived from audience label) to a consistent icon + color
// scheme, so job cards read at a glance instead of everything looking the same white card.
function getJobCategoryStyle(job) {
    const label = getJobAudienceLabel(job);
    const map = {
        'หัวหน้างาน': { icon: '👔', bar: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 border-violet-100', iconBg: 'bg-violet-100' },
        'คลังสินค้า': { icon: '📦', bar: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-100', iconBg: 'bg-amber-100' },
        'งานปฏิบัติการ': { icon: '⚙️', bar: 'bg-kcblue', chip: 'bg-blue-50 text-kcblue border-blue-100', iconBg: 'bg-blue-100' },
        'งานทำความสะอาด': { icon: '🧹', bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-100', iconBg: 'bg-emerald-100' }
    };

    return map[label] || { icon: '💼', bar: 'bg-slate-400', chip: 'bg-slate-100 text-slate-700 border-slate-200', iconBg: 'bg-slate-100' };
}

// A job counts as "ใหม่" for badge purposes if it was created within the last 7 days.
function isJobNew(job) {
    if (!job.created_at) return false;
    const created = new Date(job.created_at).getTime();
    if (Number.isNaN(created)) return false;
    return (Date.now() - created) / (1000 * 60 * 60 * 24) <= 7;
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

function resetFilters() {
    const searchInput = document.getElementById('searchKeyword');
    const dd1 = document.getElementById('dd1');
    const dd2 = document.getElementById('dd2');
    const dd3 = document.getElementById('dd3');

    if (searchInput) searchInput.value = '';
    if (dd1) dd1.value = '';
    if (typeof resetDropdown === 'function') {
        resetDropdown(dd2, 'โปรดเลือกจังหวัดก่อน');
        resetDropdown(dd3, 'โปรดเลือกอำเภอก่อน');
    }

    toggleClearKeywordBtn();

    if (typeof submitJobSearch === 'function') {
        submitJobSearch();
    }
}

// Called by the "นำไปใช้" button in the location filter panel. Selecting a location via the
// structured dropdowns is a distinct, deliberate action - any leftover free-text keyword from
// an earlier search would silently conflict with it (AND-logic => 0 results with no obvious cause).
// So applying a location filter always clears the keyword box first.
function applyLocationFilter() {
    const searchInput = document.getElementById('searchKeyword');
    if (searchInput) searchInput.value = '';
    toggleClearKeywordBtn();

    if (typeof submitJobSearch === 'function') {
        submitJobSearch();
    }
}

// Called by the main "ค้นหา" button / Enter key on the keyword box. Symmetric to
// applyLocationFilter(): using the keyword search is a distinct, deliberate action, so any
// leftover location filter from a previous search is always cleared first - regardless of
// whether the keyword search finds a match or not, per user requirement.
function submitKeywordSearch() {
    const dd1 = document.getElementById('dd1');
    const dd2 = document.getElementById('dd2');
    const dd3 = document.getElementById('dd3');

    if (dd1) dd1.value = '';
    if (typeof resetDropdown === 'function') {
        resetDropdown(dd2, 'โปรดเลือกจังหวัดก่อน');
        resetDropdown(dd3, 'โปรดเลือกอำเภอก่อน');
    }

    if (typeof submitJobSearch === 'function') {
        submitJobSearch();
    }
}

// Removes only the location facet (keeps keyword untouched) - used by the active filter chips.
function clearLocationFilters() {
    const dd1 = document.getElementById('dd1');
    const dd2 = document.getElementById('dd2');
    const dd3 = document.getElementById('dd3');

    if (dd1) dd1.value = '';
    if (typeof resetDropdown === 'function') {
        resetDropdown(dd2, 'โปรดเลือกจังหวัดก่อน');
        resetDropdown(dd3, 'โปรดเลือกอำเภอก่อน');
    }

    if (typeof submitJobSearch === 'function') {
        submitJobSearch();
    }
}

// Removes only the search keyword (keeps location filters untouched).
function clearKeywordOnly() {
    const searchInput = document.getElementById('searchKeyword');
    if (searchInput) searchInput.value = '';
    toggleClearKeywordBtn();

    if (typeof submitJobSearch === 'function') {
        submitJobSearch();
    }
}

function toggleClearKeywordBtn() {
    const searchInput = document.getElementById('searchKeyword');
    const btn = document.getElementById('clearKeywordBtn');
    if (!btn) return;

    if (searchInput && searchInput.value.trim()) {
        btn.classList.remove('hidden');
    } else {
        btn.classList.add('hidden');
    }
}

function updateFilterActiveDot() {
    const dd1 = document.getElementById('dd1');
    const dd2 = document.getElementById('dd2');
    const dd3 = document.getElementById('dd3');
    const dot = document.getElementById('filterActiveDot');

    const hasActiveFilters = (dd1 && dd1.value) || (dd2 && dd2.value) || (dd3 && dd3.value);

    if (dot) {
        if (hasActiveFilters) {
            dot.classList.remove('hidden');
        } else {
            dot.classList.add('hidden');
        }
    }
}

// Renders removable chips for each active location facet so the user always sees
// exactly which filters are combined with the keyword search (fixes the "stuck / stale data" confusion).
function renderActiveChips() {
    const row = document.getElementById('activeChipsRow');
    if (!row) return;

    const dd1 = document.getElementById('dd1');
    const dd2 = document.getElementById('dd2');
    const dd3 = document.getElementById('dd3');

    const p1 = dd1 ? dd1.value : '';
    const p2 = dd2 ? dd2.value : '';
    const p3 = dd3 ? dd3.value : '';

    const chips = [];
    if (p1) chips.push({ icon: '📍', label: p1 });
    if (p2) chips.push({ icon: '🏘️', label: p2 });
    if (p3) chips.push({ icon: '🏠', label: p3 });

    if (chips.length === 0) {
        row.classList.add('hidden');
        row.classList.remove('flex');
        row.innerHTML = '';
        return;
    }

    row.innerHTML = chips.map(chip => `
        <span class="inline-flex items-center gap-1.5 rounded-full bg-[#eef5ff] text-kcdark text-xs font-bold pl-3 pr-2 py-1.5">
            ${chip.icon} ${chip.label}
        </span>
    `).join('') + `
        <button type="button" onclick="clearLocationFilters()" class="text-xs font-bold text-slate-400 hover:text-red-500 underline underline-offset-2 transition-colors">ล้างพื้นที่ทั้งหมด</button>
    `;
    row.classList.remove('hidden');
    row.classList.add('flex');
}

function toggleFilterPanel() {
    const panel = document.getElementById('filterPanel');
    const backdrop = document.getElementById('filterBackdrop');
    
    if (!panel) return;
    
    if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        if (backdrop) backdrop.classList.remove('hidden');
    } else {
        panel.classList.add('hidden');
        if (backdrop) backdrop.classList.add('hidden');
    }
}

function closeFilterPanel() {
    const panel = document.getElementById('filterPanel');
    const backdrop = document.getElementById('filterBackdrop');
    
    if (panel) panel.classList.add('hidden');
    if (backdrop) backdrop.classList.add('hidden');
}

