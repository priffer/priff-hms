const CURRENT_JOB_COMPANY_ID = localStorage.getItem('current_company_id') || 'comp_kc_clean';
let targetJobIdToDelete = null;

async function fetchJobs() {
    const tbody = document.getElementById('jobTableBody');
    tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-500 font-bold">กำลังโหลดข้อมูลประกาศงาน...</td></tr>';
    
    try {
        const data = await JobService.getJobsByCompany(CURRENT_JOB_COMPANY_ID);
        tbody.innerHTML = '';
        
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-500 font-bold">ยังไม่มีประกาศงานในบริษัทของคุณ</td></tr>';
            return;
        }

        data.forEach(job => {
            const tr = document.createElement('tr');
            tr.className = 'border-b border-gray-200 hover:bg-gray-50 transition-colors';
            tr.innerHTML = `
                <td class="p-3">
                    <p class="font-bold text-gray-900 text-base">${job.title}</p>
                    <p class="text-xs text-gray-500">${job.salary_text}</p>
                </td>
                <td class="p-3">
                    <span class="inline-block bg-blue-50 text-kcblue border border-kcblue px-2 py-0.5 text-xs font-bold">${job.zone_name}</span>
                </td>
                <td class="p-3 text-center">
                    <label class="inline-flex items-center cursor-pointer select-none">
                        <input type="checkbox" ${job.is_active ? 'checked' : ''} onchange="toggleJobStatus(${job.id}, this.checked)" class="sr-only peer">
                        <div class="w-12 h-6 bg-gray-300 border-2 border-gray-400 peer-checked:bg-green-600 peer-checked:border-green-700 relative transition-colors">
                            <div class="absolute top-0.5 left-0.5 bg-white w-4 h-4 border border-gray-400 transition-transform peer-checked:translate-x-6"></div>
                        </div>
                    </label>
                </td>
                <td class="p-3 text-center">
                    <div class="flex justify-center gap-2">
                        <button onclick="openJobModal(${job.id})" class="border border-gray-400 bg-gray-100 text-gray-700 px-3 py-1.5 text-xs font-bold hover:bg-kcblue hover:text-white hover:border-kcblue transition-colors cursor-pointer">แก้ไข</button>
                        <button onclick="confirmDeleteJob(${job.id}, '${job.title}')" class="border border-red-600 bg-red-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-red-700 hover:border-red-700 transition-colors cursor-pointer">ลบ</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Error fetching jobs:', err);
        tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-red-500 font-bold">โหลดข้อมูลล้มเหลว</td></tr>';
    }
}

async function toggleJobStatus(jobId, isActive) {
    try {
        await JobService.toggleStatus(jobId, isActive, CURRENT_JOB_COMPANY_ID);
    } catch (err) {
        alert('อัปเดตสถานะไม่สำเร็จ: ' + err.message);
        fetchJobs(); 
    }
}

function confirmDeleteJob(jobId, jobTitle) {
    targetJobIdToDelete = jobId;
    document.getElementById('deleteTargetName').innerText = jobTitle;
    const modal = document.getElementById('deleteConfirmModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeDeleteModal() {
    targetJobIdToDelete = null;
    const modal = document.getElementById('deleteConfirmModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

document.getElementById('executeDeleteBtn').addEventListener('click', async () => {
    if (!targetJobIdToDelete) return;
    try {
        await JobService.deleteJob(targetJobIdToDelete, CURRENT_JOB_COMPANY_ID);
        closeDeleteModal();
        fetchJobs();
    } catch (err) {
        alert('เกิดข้อผิดพลาดในการลบ: ' + err.message);
    }
});

function openJobModal(id = null) {
    document.getElementById('jobId').value = '';
    document.getElementById('jobTitle').value = '';
    document.getElementById('jobSalary').value = '';
    document.getElementById('jobCompanyName').value = '';
    document.getElementById('jobZone').value = '';
    document.getElementById('jobContent').value = '';
    document.getElementById('jobModalTitle').innerText = id ? 'แก้ไขประกาศงาน' : 'สร้างประกาศงานใหม่';
    
    if (id) fetchJobForEdit(id);
    
    const modal = document.getElementById('jobModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeJobModal() {
    const modal = document.getElementById('jobModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function fetchJobForEdit(id) {
    try {
        const data = await JobService.getJobById(id, CURRENT_JOB_COMPANY_ID);
        document.getElementById('jobId').value = data.id;
        document.getElementById('jobTitle').value = data.title || '';
        document.getElementById('jobSalary').value = data.salary_text || '';
        document.getElementById('jobCompanyName').value = data.company_name || '';
        document.getElementById('jobZone').value = data.zone_name || '';
        document.getElementById('jobContent').value = data.content || '';
    } catch (err) {
        alert('เกิดข้อผิดพลาดในการดึงข้อมูล: ' + err.message);
        closeJobModal();
    }
}

async function saveJob() {
    const id = document.getElementById('jobId').value;
    const title = document.getElementById('jobTitle').value.trim();
    const salary_text = document.getElementById('jobSalary').value.trim();
    const company_name = document.getElementById('jobCompanyName').value.trim();
    const zone_name = document.getElementById('jobZone').value.trim();
    const content = document.getElementById('jobContent').value.trim();

    if (!title || !salary_text || !zone_name) {
        alert('กรุณากรอกข้อมูลที่มีเครื่องหมายดอกจัน (*) ให้ครบถ้วน');
        return;
    }

    const payload = { title, salary_text, company_name, zone_name, content };

    try {
        await JobService.saveJob(payload, id, CURRENT_JOB_COMPANY_ID);
        closeJobModal();
        fetchJobs(); 
    } catch (err) {
        alert('บันทึกข้อมูลไม่สำเร็จ: ' + err.message);
    }
}