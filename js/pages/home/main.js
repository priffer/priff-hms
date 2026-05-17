document.addEventListener('DOMContentLoaded', () => {
    loadSiteSettings();
    initLocationFilters();
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
        console.error('Error fetching jobs:', err);
        grid.innerHTML = '<div class="col-span-full text-center p-8 text-red-500 font-bold">ไม่สามารถดึงข้อมูลตำแหน่งงานได้</div>';
    }
}

function renderJobGrid() {
    const grid = document.getElementById('jobGrid');
    document.getElementById('jobCount').innerText = filteredJobs.length;
    grid.innerHTML = '';

    if (filteredJobs.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center p-12 bg-white border border-gray-300 text-gray-500 font-bold">ไม่พบตำแหน่งงาน</div>';
        document.getElementById('paginationControls').innerHTML = '';
        return;
    }

    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedItems = filteredJobs.slice(startIndex, startIndex + itemsPerPage);

    paginatedItems.forEach(job => {
        const companyName = job.company_name || document.getElementById('dynamicCompanyName').innerText;
        grid.innerHTML += `
            <div class="bg-white border border-gray-300 p-5 flex flex-col justify-between hover:shadow-md transition-shadow relative">
                <div>
                    <div class="mb-3"><span class="inline-block bg-blue-50 text-kcblue border border-kcblue px-2 py-0.5 text-xs font-bold">📍 โซน: ${job.zone_name}</span></div>
                    <h3 class="font-bold text-gray-900 text-lg mb-1 leading-snug line-clamp-2">${job.title}</h3>
                    <p class="text-sm font-bold text-kcblue mb-4">${companyName}</p>
                </div>
                <div class="mt-4 pt-4 border-t border-gray-100">
                    <p class="text-green-600 font-bold text-base mb-4">รายได้: ${job.salary_text}</p>
                    <button onclick="openJobModal(${job.id})" class="w-full border border-gray-400 bg-gray-50 text-gray-800 py-2 text-sm font-bold hover:bg-kcblue hover:text-white hover:border-kcblue transition-colors">
                        ดูรายละเอียด →
                    </button>
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
        btn.className = `w-10 h-10 font-bold border transition-colors ${currentPage === i ? 'bg-kcblue text-white border-kcblue' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'}`;
        btn.onclick = () => { currentPage = i; renderJobGrid(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
        container.appendChild(btn);
    }
}