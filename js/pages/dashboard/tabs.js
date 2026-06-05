let currentTab = 'applied';

async function switchTab(tabName) {
    currentTab = tabName;
    const tableView = document.getElementById('tableView');
    const settingsView = document.getElementById('settingsView');
    const tabs = ['tab-applied', 'tab-interview', 'tab-hired', 'tab-rejected', 'tab-settings'];

    tabs.forEach(t => {
        const el = document.getElementById(t);
        if (!el) return;
        
        let baseClass = "px-4 py-2 font-bold rounded-none border-0 cursor-pointer ";
        if (t === 'tab-settings') {
            baseClass += "ml-auto ";
        }

        if (t === `tab-${tabName}`) {
            el.className = baseClass + "bg-kcblue text-white";
        } else {
            el.className = baseClass + "bg-gray-200 text-gray-700 hover:bg-gray-300";
        }
    });

    if (tabName === 'settings') {
        if (tableView) tableView.classList.add('hidden');
        if (settingsView) settingsView.classList.remove('hidden');
        loadSettings();
    } else {
        if (tableView) tableView.classList.remove('hidden');
        if (settingsView) settingsView.classList.add('hidden');
        fetchEmployees();
    }
}

async function fetchEmployees() {
    const tableBody = document.getElementById('employeeTableBody');
    if (!tableBody) return;
    
    tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-10 text-kcblue font-bold">กำลังดึงข้อมูล...</td></tr>';

    try {
        const data = await CandidateService.getCandidatesByStatus(currentTab);

        if (!data || data.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-10 text-gray-400">ไม่พบข้อมูลในหมวดนี้</td></tr>';
            return;
        }

        tableBody.innerHTML = '';
        data.forEach(emp => {
            const date = new Date(emp.created_at).toLocaleDateString('th-TH');
            
            let reconsideredBadge = '';
            if (emp.is_reconsidered && emp.status !== 'rejected' && emp.status !== 'hired') {
                reconsideredBadge = `<span class="inline-block bg-purple-100 border border-purple-300 text-purple-700 text-[10px] px-1.5 py-0.5 font-bold ml-2">🔄 พิจารณาใหม่</span>`;
            }

            let badgeHtml = '';
            if (emp.status === 'hired' && emp.available_start_date) {
                const startDate = new Date(emp.available_start_date).toLocaleDateString('th-TH');
                badgeHtml = `<div class="mt-2 inline-block bg-green-50 border border-green-200 text-green-700 text-xs px-2 py-1 font-bold">🟢 เริ่มงาน: ${startDate}</div>`;
            } else if (emp.status === 'interview' && emp.interview_date) {
                const intDate = new Date(emp.interview_date).toLocaleDateString('th-TH');
                const intTime = emp.interview_time ? ` เวลา ${emp.interview_time} น.` : '';
                const intType = emp.interview_type === 'online' ? '💻 ออนไลน์' : '🏢 ออฟฟิศ';
                badgeHtml = `<div class="mt-2 inline-block bg-orange-50 border border-orange-200 text-orange-700 text-xs px-2 py-1 font-bold">🗓️ นัด: ${intDate}${intTime} (${intType})</div>`;
            }

            tableBody.innerHTML += `
                <tr class="border-b border-gray-200 hover:bg-gray-50 text-sm">
                    <td class="p-3">${date}</td>
                    <td class="p-3">
                        <span class="font-bold text-kcblue text-base">${emp.full_name}</span>${reconsideredBadge}<br>
                        ${badgeHtml}
                    </td>
                    <td class="p-3">${emp.job_group}<br><span class="text-xs text-gray-500">${emp.interested_position}</span></td>
                    <td class="p-3 text-center">
                        <button onclick="viewDetails('${emp.id}')" class="bg-kcblue text-white px-4 py-1 font-bold rounded-none border-0 hover:bg-kcyellow hover:text-kcblue cursor-pointer">จัดการ</button>
                    </td>
                </tr>
            `;
        });
    } catch (err) {
        console.error(err);
        tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-10 text-red-500">เกิดข้อผิดพลาดในการดึงข้อมูล</td></tr>';
    }
}