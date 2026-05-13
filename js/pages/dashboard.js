let currentTab = 'applied'; 

function switchTab(tabName) {
    currentTab = tabName;
    
    const tabApplied = document.getElementById('tab-applied');
    const tabHired = document.getElementById('tab-hired');

    if (tabApplied && tabHired) {
        if (tabName === 'applied') {
            tabApplied.className = "px-4 py-2 bg-kcblue text-white font-bold rounded-none border-0 cursor-pointer";
            tabHired.className = "px-4 py-2 bg-gray-200 text-gray-700 font-bold rounded-none border-0 cursor-pointer hover:bg-gray-300";
        } else {
            tabHired.className = "px-4 py-2 bg-kcblue text-white font-bold rounded-none border-0 cursor-pointer";
            tabApplied.className = "px-4 py-2 bg-gray-200 text-gray-700 font-bold rounded-none border-0 cursor-pointer hover:bg-gray-300";
        }
    }

    fetchEmployees();
}

async function handleLogout() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
        console.error('Logout Error:', error.message);
        alert('เกิดข้อผิดพลาดในการออกจากระบบ');
    } else {
        window.location.href = 'login.html';
    }
}

async function fetchEmployees() {
    const tableBody = document.getElementById('employeeTableBody');
    if (!tableBody) return; 

    tableBody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-kcblue font-bold">กำลังโหลดข้อมูล...</td></tr>';

    const { data, error } = await supabaseClient
        .from('employees')
        .select('*')
        .eq('status', currentTab) 
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching data:', error);
        tableBody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-red-500 font-bold">เกิดข้อผิดพลาดในการดึงข้อมูล</td></tr>';
        return;
    }

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-gray-500 font-bold">ไม่พบข้อมูล</td></tr>`;
        return;
    }

    tableBody.innerHTML = '';

    data.forEach(emp => {
        const date = new Date(emp.created_at).toLocaleDateString('th-TH');
        
        const statusBadge = emp.status === 'applied' 
            ? `<span class="bg-kcyellow text-kcblue px-2 py-1 text-xs font-bold rounded-none">รอพิจารณา</span>`
            : `<span class="bg-green-600 text-white px-2 py-1 text-xs font-bold rounded-none">พนักงาน</span>`;

        tableBody.innerHTML += `
            <tr class="border-b border-gray-200 hover:bg-gray-50">
                <td class="px-4 py-3 text-sm">${date}</td>
                <td class="px-4 py-3 text-sm font-semibold text-kcblue">${emp.full_name || '-'}</td>
                <td class="px-4 py-3 text-sm">${emp.job_group || '-'}</td>
                <td class="px-4 py-3 text-sm">${emp.phone_number || '-'}</td>
                <td class="px-4 py-3 text-sm">${statusBadge}</td>
                <td class="px-4 py-3 text-sm">
                    ${emp.resume_url ? `<a href="${emp.resume_url}" target="_blank" class="text-kcblue underline font-semibold hover:text-kcyellow transition-colors">ดูเอกสาร</a>` : '-'}
                </td>
                <td class="px-4 py-3 text-sm">
                    <button onclick="viewDetails('${emp.id}')" class="bg-kcblue text-white px-3 py-1 text-sm font-bold rounded-none hover:bg-kcyellow hover:text-kcblue transition-colors border-0 cursor-pointer">
                        จัดการ
                    </button>
                </td>
            </tr>
        `;
    });
}

async function viewDetails(id) {
    const { data, error } = await supabaseClient
        .from('employees')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        alert('ไม่สามารถดึงข้อมูลได้');
        console.error(error);
        return;
    }

    const modalHtml = `
        <div id="detailsModal" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div class="bg-white w-full max-w-2xl rounded-none shadow-none border-4 border-kcblue p-6">
                
                <div class="flex justify-between items-center mb-4 border-b-2 border-kcblue pb-2">
                    <h2 class="text-xl font-bold text-kcblue">รายละเอียด</h2>
                    <button onclick="closeModal()" class="text-gray-500 hover:text-red-500 font-bold text-2xl border-0 bg-transparent cursor-pointer">&times;</button>
                </div>

                <div class="space-y-3 text-sm text-gray-800">
                    <div class="grid grid-cols-2 gap-4">
                        <p><strong>ชื่อ-นามสกุล:</strong> ${data.full_name || '-'}</p>
                        <p><strong>เบอร์โทรศัพท์:</strong> ${data.phone_number || '-'}</p>
                        <p><strong>กลุ่มงาน:</strong> ${data.job_group || '-'}</p>
                        <p><strong>ตำแหน่งที่สนใจ:</strong> ${data.interested_position || '-'}</p>
                        <p><strong>เงินเดือนที่คาดหวัง:</strong> ${data.expected_salary || '-'}</p>
                        <p><strong>วันที่พร้อมเริ่มงาน:</strong> ${data.available_start_date || '-'}</p>
                    </div>
                    
                    ${data.status === 'hired' ? `
                        <div class="mt-4 p-3 bg-green-50 border border-green-600">
                            <p class="text-green-700 font-bold text-lg">รหัสพนักงาน: ${data.emp_id || '-'}</p>
                        </div>
                    ` : ''}
                </div>

                <div class="mt-6 flex justify-end gap-2">
                    <button onclick="closeModal()" class="px-4 py-2 bg-gray-200 text-gray-700 font-bold rounded-none hover:bg-gray-300 border-0 cursor-pointer">
                        ปิดหน้าต่าง
                    </button>
                    ${data.status === 'applied' ? `
                        <button onclick="hireEmployee('${data.id}')" class="px-4 py-2 bg-kcyellow text-kcblue font-bold rounded-none hover:bg-kcblue hover:text-kcyellow transition-colors border-0 cursor-pointer">
                            รับเข้าทำงาน
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    closeModal();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeModal() {
    const oldModal = document.getElementById('detailsModal');
    if (oldModal) oldModal.remove();
}

async function hireEmployee(id) {
    if (!confirm('ยืนยันการรับผู้สมัครท่านนี้เข้าทำงาน?')) return;

    const dateStr = new Date().toISOString().slice(0,7).replace('-',''); 
    const randomCode = Math.floor(1000 + Math.random() * 9000);
    const newEmpId = `EMP-${dateStr}-${randomCode}`;

    const { error } = await supabaseClient
        .from('employees')
        .update({ 
            status: 'hired',
            emp_id: newEmpId
        })
        .eq('id', id);

    if (error) {
        console.error('Hire Error:', error);
        alert('เกิดข้อผิดพลาดในการอัปเดตข้อมูล');
        return;
    }

    alert(`รับเข้าทำงานเรียบร้อย!\nรหัสพนักงาน: ${newEmpId}`);
    closeModal();
    fetchEmployees();
}

document.addEventListener('DOMContentLoaded', () => {
    fetchEmployees();
    
    const tabApplied = document.getElementById('tab-applied');
    const tabHired = document.getElementById('tab-hired');
    if(tabApplied) tabApplied.addEventListener('click', () => switchTab('applied'));
    if(tabHired) tabHired.addEventListener('click', () => switchTab('hired'));
});