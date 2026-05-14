let currentTab = 'applied';

// 1. ระบบจัดการแท็บและการแสดงผล
async function switchTab(tabName) {
    currentTab = tabName;
    const tableView = document.getElementById('tableView');
    const settingsView = document.getElementById('settingsView');
    const tabs = ['tab-applied', 'tab-interview', 'tab-hired', 'tab-rejected', 'tab-settings'];

    // Update Tab UI แบบใหม่ ไม่ให้บั๊กปุ่มกระโดด
    tabs.forEach(t => {
        const el = document.getElementById(t);
        
        // คลาสพื้นฐานที่ทุกปุ่มต้องมี (ทรงเหลี่ยม)
        let baseClass = "px-4 py-2 font-bold rounded-none border-0 cursor-pointer ";
        
        // ถ้ารอบนี้กำลังวนลูปจัดการปุ่ม 'ตั้งค่า' ให้บังคับใส่ ml-auto เพื่อผลักไปชิดขวาเสมอ
        if (t === 'tab-settings') {
            baseClass += "ml-auto ";
        }

        // ใส่สีกรมท่าถ้าถูกเลือก ใส่สีเทาถ้าไม่ได้เลือก
        if (t === `tab-${tabName}`) {
            el.className = baseClass + "bg-kcblue text-white";
        } else {
            el.className = baseClass + "bg-gray-200 text-gray-700 hover:bg-gray-300";
        }
    });

    if (tabName === 'settings') {
        tableView.classList.add('hidden');
        settingsView.classList.remove('hidden');
        loadSettings();
    } else {
        tableView.classList.remove('hidden');
        settingsView.classList.add('hidden');
        fetchEmployees();
    }
}

// 2. ดึงข้อมูลพนักงาน/ผู้สมัคร
async function fetchEmployees() {
    const tableBody = document.getElementById('employeeTableBody');
    tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-10 text-kcblue font-bold">กำลังดึงข้อมูล...</td></tr>';

    const { data, error } = await supabaseClient
        .from('employees')
        .select('*')
        .eq('status', currentTab)
        .order('created_at', { ascending: false });

    if (error || !data || data.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-10 text-gray-400">ไม่พบข้อมูลในหมวดนี้</td></tr>';
        return;
    }

    tableBody.innerHTML = '';
    data.forEach(emp => {
        const date = new Date(emp.created_at).toLocaleDateString('th-TH');
        tableBody.innerHTML += `
            <tr class="border-b border-gray-200 hover:bg-gray-50 text-sm">
                <td class="p-3">${date}</td>
                <td class="p-3 font-bold text-kcblue">${emp.full_name}</td>
                <td class="p-3">${emp.job_group}<br><span class="text-xs text-gray-500">${emp.interested_position}</span></td>
                <td class="p-3 text-center">
                    <button onclick="viewDetails('${emp.id}')" class="bg-kcblue text-white px-4 py-1 font-bold rounded-none border-0 hover:bg-kcyellow hover:text-kcblue cursor-pointer">จัดการ</button>
                </td>
            </tr>
        `;
    });
}

// 3. หน้าต่างรายละเอียดและเปลี่ยนสถานะ (Workflow Logic)
async function viewDetails(id) {
    const { data: emp, error } = await supabaseClient.from('employees').select('*').eq('id', id).single();
    if (error) return;

    const modalHtml = `
        <div id="detailModal" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div class="bg-white w-full max-w-2xl rounded-none border-4 border-kcblue p-6 overflow-y-auto max-h-[90vh]">
                <div class="flex justify-between items-center mb-4 border-b-2 border-kcblue pb-2">
                    <h2 class="text-xl font-bold text-kcblue uppercase">จัดการข้อมูลผู้สมัคร</h2>
                    <button onclick="closeModal()" class="text-2xl font-bold border-0 bg-transparent cursor-pointer">&times;</button>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 mb-6 text-sm">
                    <p><strong>ชื่อ:</strong> ${emp.full_name}</p>
                    <p><strong>เบอร์โทร:</strong> ${emp.phone_number}</p>
                    <p><strong>อีเมล:</strong> ${emp.email || '-'}</p>
                    <p><strong>ตำแหน่ง:</strong> ${emp.interested_position}</p>
                    <p><strong>เงินเดือนที่ต้องการ:</strong> ${emp.expected_salary} บาท</p>
                    <p><strong>ไฟล์แนบ:</strong> <a href="${emp.resume_url}" target="_blank" class="text-blue-600 underline">คลิกดูเอกสาร</a></p>
                </div>

                <div class="mb-6">
                    <label class="block font-bold text-kcblue mb-1 text-sm">บันทึกช่วยจำจากแอดมิน (Admin Remarks):</label>
                    <textarea id="remarksInput" class="w-full border-2 border-gray-300 p-2 text-sm rounded-none outline-none focus:border-kcblue" rows="3">${emp.admin_remarks || ''}</textarea>
                    <button onclick="updateRemarks('${emp.id}')" class="mt-2 text-xs bg-gray-800 text-white px-3 py-1 font-bold rounded-none border-0 cursor-pointer">บันทึกโน้ต</button>
                </div>

                <div class="flex flex-wrap gap-2 justify-end border-t-2 border-gray-100 pt-4">
                    ${emp.status === 'applied' ? `<button onclick="updateStatus('${emp.id}', 'interview')" class="bg-orange-500 text-white px-4 py-2 font-bold rounded-none border-0 cursor-pointer">นัดสัมภาษณ์</button>` : ''}
                    ${emp.status === 'interview' || emp.status === 'applied' ? `<button onclick="processHiring('${emp.id}')" class="bg-green-600 text-white px-4 py-2 font-bold rounded-none border-0 cursor-pointer">รับเข้าทำงาน</button>` : ''}
                    ${emp.status !== 'rejected' ? `<button onclick="updateStatus('${emp.id}', 'rejected')" class="bg-red-600 text-white px-4 py-2 font-bold rounded-none border-0 cursor-pointer">ไม่ผ่านเกณฑ์</button>` : ''}
                </div>
            </div>
        </div>
    `;
    document.getElementById('modalContainer').innerHTML = modalHtml;
}

function closeModal() { document.getElementById('modalContainer').innerHTML = ''; }

async function updateStatus(id, newStatus) {
    if (!confirm(`ยืนยันการเปลี่ยนสถานะเป็น: ${newStatus}?`)) return;
    const { error } = await supabaseClient.from('employees').update({ status: newStatus }).eq('id', id);
    if (!error) { closeModal(); fetchEmployees(); }
}

async function updateRemarks(id) {
    const text = document.getElementById('remarksInput').value;
    const { error } = await supabaseClient.from('employees').update({ admin_remarks: text }).eq('id', id);
    if (!error) alert('บันทึกโน้ตเรียบร้อย');
}

async function processHiring(id) {
    if (!confirm('ยืนยันรับคนนี้เข้าทำงาน? ระบบจะออกรหัสพนักงานให้ทันที')) return;
    const newId = `EMP-${Date.now().toString().slice(-6)}`; // ตัวอย่าง Simple Gen
    const { error } = await supabaseClient.from('employees').update({ status: 'hired', emp_id: newId }).eq('id', id);
    if (!error) { closeModal(); fetchEmployees(); }
}

// 4. ระบบตั้งค่า (Settings Management)
async function loadSettings() {
    const { data } = await supabaseClient.from('system_settings').select('*');
    if (!data) return;
    data.forEach(s => {
        if (s.setting_key === 'PDPA_CONTENT') document.getElementById('pdpaInput').value = s.setting_value;
        if (s.setting_key === 'LAST_EMP_RUN_NO') document.getElementById('lastEmpNo').value = s.setting_value;
        if (s.setting_key === 'TAX_PERCENT') document.getElementById('taxRate').value = s.setting_value;
        if (s.setting_key === 'SOCIAL_SECURITY_PERCENT') document.getElementById('ssoRate').value = s.setting_value;
    });
}

async function saveSettings() {
    const updates = [
        { key: 'PDPA_CONTENT', val: document.getElementById('pdpaInput').value },
        { key: 'LAST_EMP_RUN_NO', val: document.getElementById('lastEmpNo').value },
        { key: 'TAX_PERCENT', val: document.getElementById('taxRate').value },
        { key: 'SOCIAL_SECURITY_PERCENT', val: document.getElementById('ssoRate').value }
    ];

    for (let item of updates) {
        await supabaseClient.from('system_settings').update({ setting_value: item.val }).eq('setting_key', item.key);
    }
    alert('บันทึกการตั้งค่าสำเร็จ!');
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}

document.addEventListener('DOMContentLoaded', () => fetchEmployees());