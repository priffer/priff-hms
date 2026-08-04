document.addEventListener('DOMContentLoaded', () => {
    loadSiteSettings();
    fetchActiveJobs();
});

async function fetchActiveJobs() {
    const grid = document.getElementById('jobGrid');
    grid.innerHTML = '<div class="col-span-full text-center p-8 text-gray-500 font-bold">กำลังค้นหาตำแหน่งงานเปิดรับ...</div>';

    try {
        const data = await JobService.getActiveJobs(CURRENT_SITE_COMPANY_ID);
        allJobs = data || [];
        filteredJobs = [...allJobs];
        renderJobGrid();
    } catch (err) {
        grid.innerHTML = '<div class="col-span-full text-center p-8 text-red-500 font-bold">ไม่สามารถดึงข้อมูลตำแหน่งงานได้</div>';
    }
}

function renderJobGrid() {
    const grid = document.getElementById('jobGrid');
    document.getElementById('jobCount').innerText = filteredJobs.length;
    grid.innerHTML = '';
 
    if (filteredJobs.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center p-12 bg-white border border-slate-200 text-slate-500 font-bold">ไม่พบตำแหน่งงาน</div>';
        document.getElementById('paginationControls').innerHTML = '';
        return;
    }
 
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedItems = filteredJobs.slice(startIndex, startIndex + itemsPerPage);
 
    paginatedItems.forEach(job => {
        const companyName = job.company_name || document.getElementById('dynamicCompanyName').innerText;
        const jobType = job.job_type || job.position_type || job.hiring_type || 'งานทั่วไป';
        const locationText = job.zone_name || 'ไม่ระบุพื้นที่';
        grid.innerHTML += `
            <div class="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm hover:shadow-xl transition-all duration-200 flex flex-col justify-between">
                <div class="space-y-4">
                    <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                        <div class="min-w-0">
                            <p class="text-xs uppercase tracking-[0.25em] text-slate-400 font-semibold mb-2">${jobType}</p>
                            <h3 class="font-bold text-slate-900 text-lg sm:text-xl leading-snug line-clamp-2">${job.title}</h3>
                            <p class="text-sm text-slate-500 mt-2">${companyName}</p>
                        </div>
                        <span class="inline-flex items-center justify-center rounded-full bg-slate-100 text-slate-700 px-3 py-1 text-xs font-semibold">${locationText}</span>
                    </div>
                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div class="rounded-2xl bg-slate-50 p-4">
                            <p class="text-xs uppercase tracking-[0.25em] text-slate-500">รายได้</p>
                            <p class="mt-1 text-lg font-bold text-slate-900">${job.salary_text || 'ตามตกลง'}</p>
                        </div>
                        <div class="rounded-2xl bg-slate-50 p-4">
                            <p class="text-xs uppercase tracking-[0.25em] text-slate-500">ตำแหน่ง</p>
                            <p class="mt-1 text-sm text-slate-700">${job.employment_type || 'เต็มเวลา'}</p>
                        </div>
                    </div>
                </div>
                <div class="mt-5 grid gap-3 sm:grid-cols-2">
                    <button onclick="applyForThisJob(${job.id})" class="w-full rounded-2xl bg-kcblue text-white px-4 py-3 text-sm font-bold hover:bg-kcyellow hover:text-kcblue transition-colors shadow-sm">สมัครงาน</button>
                    <button onclick="openJobModal(${job.id})" class="w-full rounded-2xl border border-slate-300 bg-white text-slate-700 px-4 py-3 text-sm font-bold hover:border-kcblue hover:text-kcblue transition-colors">ดูรายละเอียด</button>
                </div>
            </div>
        `;
    });
    renderPaginationControls();
}

function renderPaginationControls() {
    const container = document.getElementById('paginationControls');
    container.innerHTML = '';
    const totalPages = Math.ceil(filteredJobs.length / itemsPerPage);
    if (totalPages <= 1) return;

    for (let i = 1; i <= totalPages; i++) {
        const btn = document.createElement('button');
        btn.innerText = i;
        btn.className = `w-10 h-10 font-bold border transition-colors ${currentPage === i ? 'bg-kcblue text-white border-kcblue' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`;
        btn.onclick = () => { currentPage = i; renderJobGrid(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
        container.appendChild(btn);
    }
}

function resetFilters() {
    const searchInput = document.getElementById('searchKeyword');
    const dd1 = document.getElementById('dd1');
    const dd2 = document.getElementById('dd2');
    const dd3 = document.getElementById('dd3');
    const boxDd2 = document.getElementById('boxDd2');
    const boxDd3 = document.getElementById('boxDd3');

    if (searchInput) searchInput.value = '';
    if (dd1) dd1.value = '';
    if (dd2) dd2.value = '';
    if (dd3) dd3.value = '';
    if (dd2) dd2.innerHTML = '';
    if (dd3) dd3.innerHTML = '';
    if (boxDd2) boxDd2.classList.add('hidden');
    if (boxDd3) boxDd3.classList.add('hidden');
    filterJobs();
}

function toggleFilterPanel() {
    const panel = document.getElementById('searchPanel');
    if (!panel) return;
    const isOpen = !panel.classList.contains('hidden');
    if (isOpen) {
        panel.classList.add('hidden');
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
        return;
    }

    if (window.innerWidth < 640) {
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
}