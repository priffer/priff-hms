const employeeScripts = [
    'js/pages/employees/list.js',
    'js/pages/employees/modal.js',
    'js/pages/employees/actions.js'
];

function loadEmployeeScripts(index) {
    if (index >= employeeScripts.length) {
        if (typeof loadEmployees === 'function') {
            loadEmployees();
        }
        return;
    }
    
    const script = document.createElement('script');
    script.src = employeeScripts[index];
    script.onload = () => loadEmployeeScripts(index + 1);
    document.body.appendChild(script);
}

document.addEventListener('DOMContentLoaded', () => {
    loadEmployeeScripts(0);
});

// ---------------------------------------------------------
// 🌟 โค้ดส่วนจัดการแผนก
// ---------------------------------------------------------

function switchEmpMainTab(tabName) {
    const viewDir = document.getElementById('view-directory');
    const viewDept = document.getElementById('view-departments');
    const btnDir = document.getElementById('mainTab-directory');
    const btnDept = document.getElementById('mainTab-departments');
    
    if (tabName === 'directory') {
        viewDir.classList.remove('hidden');
        viewDept.classList.add('hidden');
        btnDir.className = 'px-6 py-2 font-bold border tab-active cursor-pointer transition-colors';
        btnDept.className = 'px-6 py-2 font-bold border tab-inactive cursor-pointer transition-colors hover:bg-gray-200';
    } else {
        viewDir.classList.add('hidden');
        viewDept.classList.remove('hidden');
        btnDir.className = 'px-6 py-2 font-bold border tab-inactive cursor-pointer transition-colors hover:bg-gray-200';
        btnDept.className = 'px-6 py-2 font-bold border tab-active cursor-pointer transition-colors';
        
        loadDepartments();
    }
}

async function loadDepartments() {
    const container = document.getElementById('deptCardContainer');
    if(!container) return;
    
    container.innerHTML = '<p class="col-span-full text-center text-kcblue font-bold">กำลังประมวลผลข้อมูลโครงสร้างองค์กร...</p>';

    try {
        const depts = await CandidateService.getDepartmentsWithHeadcount();
        container.innerHTML = '';
        
        if (!depts || depts.length === 0) {
            container.innerHTML = '<p class="col-span-full text-center text-gray-500 bg-gray-50 p-6 border border-gray-200">ยังไม่มีข้อมูลแผนกในระบบ</p>';
            return;
        }

        depts.forEach(dept => {
            const statusBadge = dept.is_active 
                ? '<span class="bg-green-100 text-green-700 px-2 py-0.5 text-xs font-bold border border-green-300">เปิดรับคน</span>' 
                : '<span class="bg-red-100 text-red-700 px-2 py-0.5 text-xs font-bold border border-red-300">ปิดรับคน (ระงับ)</span>';
            
            const btnToggle = dept.is_active
                ? `<button onclick="toggleDeptStatus('${dept.id}', false)" class="text-xs text-red-600 hover:underline cursor-pointer border-0 bg-transparent font-bold">ยุบ/ระงับแผนก</button>`
                : `<button onclick="toggleDeptStatus('${dept.id}', true)" class="text-xs text-green-600 hover:underline cursor-pointer border-0 bg-transparent font-bold">เปิดแผนกกลับมา</button>`;

            let btnDelete = '';
            if (dept.headcount === 0) {
                btnDelete = `<button onclick="deleteDepartmentForever('${dept.id}', '${dept.department_name}')" class="text-xs text-red-700 bg-red-100 hover:bg-red-200 px-3 py-1 font-bold border border-red-300 ml-2 cursor-pointer transition-colors shadow-sm">🗑️ ลบทิ้ง</button>`;
            }

            container.innerHTML += `
                <div class="border ${dept.is_active ? 'border-kcblue' : 'border-gray-300 bg-gray-50 opacity-80'} p-5 relative shadow-none flex flex-col h-full">
                    <div class="flex justify-between items-start mb-2">
                        <span class="bg-gray-800 text-white text-xs font-bold px-2 py-1 tracking-wider">${dept.department_code}</span>
                        ${statusBadge}
                    </div>
                    <h3 class="text-lg font-bold text-gray-900 leading-tight mb-1">${dept.department_name}</h3>
                    <p class="text-sm text-gray-500 mb-4 line-clamp-2 min-h-10">${dept.description || '-'}</p>
                    
                    <div class="mt-auto border-t border-gray-200 pt-3 flex justify-between items-end">
                        <div>
                            <p class="text-xs text-gray-500 font-bold mb-1">จำนวนคนปัจจุบัน</p>
                            <p class="text-3xl font-bold ${dept.headcount > 0 ? 'text-kcblue' : 'text-gray-400'}">${dept.headcount} <span class="text-sm font-normal text-gray-600">คน</span></p>
                        </div>
                        <div class="text-right flex items-center justify-end">
                            ${btnToggle}
                            ${btnDelete}
                        </div>
                    </div>
                </div>
            `;
        });
    } catch (err) {
        alert('โหลดแผนกไม่สำเร็จ: ' + err.message);
    }
}

async function deleteDepartmentForever(id, name) {
    if (!confirm(`ยืนยันการลบแผนก "${name}" ทิ้งถาวรใช่หรือไม่?\n\n(สามารถลบได้เพราะไม่มีพนักงานอยู่ในแผนกนี้ ข้อมูลจะถูกลบออกไปเลยครับ)`)) return;
    try {
        await CandidateService.deleteDepartment(id);
        loadDepartments();
    } catch (err) {
        alert('ลบแผนกไม่สำเร็จ: ' + err.message);
    }
}

async function saveNewDepartment() {
    const code = document.getElementById('newDeptCode').value.trim();
    const name = document.getElementById('newDeptName').value.trim();
    const desc = document.getElementById('newDeptDesc').value.trim();

    if (!code || !name) {
        alert('กรุณากรอกรหัสแผนกย่อและชื่อเต็มให้ครบถ้วนครับ');
        return;
    }

    try {
        await CandidateService.createDepartment({
            department_code: code.toUpperCase(),
            department_name: name,
            description: desc,
            is_active: true
        });
        
        alert('สร้างแผนกเรียบร้อย!');
        document.getElementById('newDeptCode').value = '';
        document.getElementById('newDeptName').value = '';
        document.getElementById('newDeptDesc').value = '';
        document.getElementById('addDeptForm').classList.add('hidden');
        loadDepartments();
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function toggleDeptStatus(id, isActive) {
    if (!confirm(isActive ? 'ต้องการเปิดใช้งานแผนกนี้อีกครั้ง?' : 'ยืนยันระงับ/ปิดแผนกนี้? (พนักงานเดิมยังอยู่ แต่จะเลือกใส่คนใหม่ไม่ได้)')) return;
    try {
        await CandidateService.updateDepartment(id, { is_active: isActive });
        loadDepartments();
    } catch (err) {
        alert('แก้ไขสถานะไม่สำเร็จ: ' + err.message);
    }
}