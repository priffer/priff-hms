document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    loadCmsSettings();
});

function checkAuth() {
    // เตรียมไว้ตรวจสอบสิทธิ์
}

function handleLogout() {
    window.location.href = 'login.html';
}

function switchAdminTab(tabName) {
    const viewCms = document.getElementById('view-cms');
    const viewJobs = document.getElementById('view-jobs');
    const btnCms = document.getElementById('tab-cms');
    const btnJobs = document.getElementById('tab-jobs');

    if (tabName === 'cms') {
        viewCms.classList.remove('hidden');
        viewJobs.classList.add('hidden');
        btnCms.className = 'px-6 py-2 font-bold border tab-active cursor-pointer transition-colors';
        btnJobs.className = 'px-6 py-2 font-bold border tab-inactive cursor-pointer transition-colors hover:bg-gray-200';
    } else {
        viewCms.classList.add('hidden');
        viewJobs.classList.remove('hidden');
        btnCms.className = 'px-6 py-2 font-bold border tab-inactive cursor-pointer transition-colors hover:bg-gray-200';
        btnJobs.className = 'px-6 py-2 font-bold border tab-active cursor-pointer transition-colors';
        fetchJobs();
    }
}

// --- CMS Logic ---
async function loadCmsSettings() {
    try {
        // ใช้ supabaseClient ให้ตรงกับ config
        const { data, error } = await supabaseClient.from('site_settings').select('*').eq('id', 1).single();
        if (error && error.code !== 'PGRST116') throw error;

        if (data) {
            document.getElementById('cmsCompanyName').value = data.company_name || '';
            document.getElementById('cmsHeadline').value = data.hero_headline || '';
            document.getElementById('cmsSubhead').value = data.hero_subhead || '';
            
            if (data.logo_url) {
                document.getElementById('logoPreview').innerHTML = `<img src="${data.logo_url}" class="w-full h-full object-contain">`;
            } else {
                document.getElementById('logoPreview').innerHTML = `<span class="text-[10px] text-gray-400 font-bold">No Logo</span>`;
            }
            
            const welfares = data.welfares || [];
            const container = document.getElementById('welfareContainer');
            container.innerHTML = '';
            welfares.forEach(w => addWelfareInput(w));
        } else {
            addWelfareInput('ประกันสังคม');
        }
    } catch (err) {
        console.error('Error loading CMS:', err);
    }
}

function addWelfareInput(value = '') {
    const container = document.getElementById('welfareContainer');
    const div = document.createElement('div');
    div.className = 'flex gap-2';
    div.innerHTML = `
        <input type="text" value="${value}" class="w-full border border-gray-300 p-2 outline-none focus:border-kcblue welfare-item text-sm">
        <button onclick="this.parentElement.remove()" class="bg-red-100 text-red-600 border border-red-300 px-3 font-bold hover:bg-red-600 hover:text-white transition-colors cursor-pointer">X</button>
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

        // ลอจิกการอัปโหลดไฟล์ไปที่ Storage
        if (logoFile) {
            const fileExt = logoFile.name.split('.').pop();
            const fileName = `logo-${Date.now()}.${fileExt}`;
            
            const { error: uploadError } = await supabaseClient.storage
                .from('public-assets')
                .upload(fileName, logoFile, { upsert: true });

            if (uploadError) throw uploadError;

            const { data: publicUrlData } = supabaseClient.storage.from('public-assets').getPublicUrl(fileName);
            logo_url = publicUrlData.publicUrl;
        }

        const payload = { id: 1, company_name, hero_headline, hero_subhead, welfares };
        if (logo_url) payload.logo_url = logo_url;

        const { error } = await supabaseClient.from('site_settings').upsert(payload);
        if (error) throw error;
        
        alert('บันทึกข้อมูลหน้าเว็บสำเร็จ');
        loadCmsSettings();
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// --- Jobs Table Logic ---
async function fetchJobs() {
    const tbody = document.getElementById('jobTableBody');
    tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-500">กำลังโหลดข้อมูล...</td></tr>';
    
    try {
        const { data, error } = await supabaseClient.from('jobs').select('*').order('created_at', { ascending: false });
        if (error) throw error;

        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-500 font-bold">ยังไม่มีประกาศงาน</td></tr>';
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
                        <button onclick="openJobModal(${job.id})" class="border border-gray-400 bg-gray-100 text-gray-700 px-3 py-1.5 text-xs font-bold hover:bg-kcblue hover:text-white hover:border-kcblue transition-colors cursor-pointer">
                            แก้ไข
                        </button>
                        <button onclick="confirmDeleteJob(${job.id}, '${job.title}')" class="border border-red-600 bg-red-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-red-700 hover:border-red-700 transition-colors cursor-pointer">
                            ลบ
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Error fetching jobs:', err);
        tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-red-500">โหลดข้อมูลล้มเหลว</td></tr>';
    }
}

async function toggleJobStatus(jobId, isActive) {
    try {
        const { error } = await supabaseClient.from('jobs').update({ is_active: isActive }).eq('id', jobId);
        if (error) {
            alert('อัปเดตสถานะไม่สำเร็จ');
            fetchJobs(); 
        }
    } catch (err) {
        console.error(err);
    }
}

// --- Delete Modal Logic ---
let targetJobIdToDelete = null;

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
        const { error } = await supabaseClient.from('jobs').delete().eq('id', targetJobIdToDelete);
        if (error) throw error;

        closeDeleteModal();
        fetchJobs();
    } catch (err) {
        alert('เกิดข้อผิดพลาดในการลบ: ' + err.message);
    }
});

// --- Job Form Modal Logic ---
function openJobModal(id = null) {
    document.getElementById('jobId').value = '';
    document.getElementById('jobTitle').value = '';
    document.getElementById('jobSalary').value = '';
    document.getElementById('jobCompanyName').value = '';
    document.getElementById('jobZone').value = '';
    document.getElementById('jobContent').value = '';
    
    document.getElementById('jobModalTitle').innerText = id ? 'แก้ไขประกาศงาน' : 'สร้างประกาศงานใหม่';
    
    if (id) {
        fetchJobForEdit(id);
    }
    
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
        const { data, error } = await supabaseClient.from('jobs').select('*').eq('id', id).single();
        if (error) throw error;
        
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
        let error;
        if (id) {
            const res = await supabaseClient.from('jobs').update(payload).eq('id', id);
            error = res.error;
        } else {
            payload.is_active = true;
            const res = await supabaseClient.from('jobs').insert([payload]);
            error = res.error;
        }

        if (error) throw error;

        closeJobModal();
        fetchJobs(); 
    } catch (err) {
        alert('บันทึกข้อมูลไม่สำเร็จ: ' + err.message);
    }
}

// --- สคริปต์สำหรับพรีวิวโลโก้ทันทีที่เลือกไฟล์ ---
document.getElementById('cmsLogo').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        const objectUrl = URL.createObjectURL(file);
        document.getElementById('logoPreview').innerHTML = `<img src="${objectUrl}" class="w-full h-full object-contain">`;
    } else {
        document.getElementById('logoPreview').innerHTML = `<span class="text-[10px] text-gray-400 font-bold">No Logo</span>`;
    }
});