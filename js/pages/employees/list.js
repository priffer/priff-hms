// 🌟 เก็บข้อมูลแผนกไว้ในหน่วยความจำชั่วคราว จะได้ไม่ต้องดึงฐานข้อมูลบ่อยๆ
let cachedDeptsForList = [];

async function loadEmployees(searchQuery = '') {
    const tbody = document.getElementById('employeeListBody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-10 text-kcblue font-bold">กำลังดึงข้อมูลพนักงาน...</td></tr>';

    try {
        // 🌟 ดึงข้อมูลแผนกมาเตรียมไว้ (ถ้ายังไม่มี)
        if (cachedDeptsForList.length === 0) {
            cachedDeptsForList = await CandidateService.getDepartmentsWithHeadcount();
        }

        const data = await CandidateService.getActiveEmployees(searchQuery);

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-10 text-gray-500">ไม่พบข้อมูลพนักงาน</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        data.forEach(emp => {
            const startDate = emp.available_start_date 
                ? new Date(emp.available_start_date).toLocaleDateString('th-TH') 
                : '<span class="text-red-500 text-xs">ยังไม่ระบุ</span>';

            // 🌟 แมป ID แผนก ให้เป็นชื่อแผนกสวยๆ
            let displayDept = emp.job_group || '-';
            if (emp.department_id) {
                const matchedDept = cachedDeptsForList.find(d => d.id === emp.department_id);
                if (matchedDept) {
                    displayDept = `<span class="text-kcblue font-bold">${matchedDept.department_name}</span>`;
                }
            }

            tbody.innerHTML += `
                <tr class="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                    <td class="p-3 font-bold text-kcblue">${emp.emp_id || '-'}</td>
                    <td class="p-3 font-bold text-gray-900">${emp.full_name}</td>
                    <td class="p-3 text-sm leading-tight">
                        ${displayDept}<br>
                        <span class="text-xs text-gray-500">ตำแหน่ง: ${emp.interested_position || '-'}</span>
                    </td>
                    <td class="p-3 text-sm">${startDate}</td>
                    <td class="p-3 text-center">
                        <button onclick="viewEmployeeDetails('${emp.id}')" class="bg-kcblue text-white px-4 py-1.5 text-xs font-bold border-0 hover:bg-kcyellow hover:text-kcblue cursor-pointer shadow-sm">เปิดแฟ้มประวัติ</button>
                    </td>
                </tr>
            `;
        });
    } catch (err) {
        console.error('Error fetching employees:', err);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-10 text-red-500 font-bold">เกิดข้อผิดพลาดในการโหลดข้อมูล</td></tr>';
    }
}

function searchEmployees() {
    const query = document.getElementById('searchInput').value.trim();
    loadEmployees(query);
}

// ผูก Event ให้กดปุ่ม Enter ในช่องค้นหาได้
const searchInput = document.getElementById('searchInput');
if (searchInput) {
    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchEmployees();
        }
    });
}