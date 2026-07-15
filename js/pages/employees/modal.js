async function viewEmployeeDetails(id) {
    try {
        const emp = await CandidateService.getCandidateById(id);
        if (!emp) return;

        // 🌟 1. ดึงข้อมูลแผนกมาเตรียมไว้ทำ Dropdown และหาชื่อแผนกปัจจุบัน
        let deptOptionsHtml = '<option value="">-- กรุณาเลือกแผนก/ฝ่าย --</option>';
        let currentDeptName = emp.job_group || '-'; // ถ้ายังไม่มีแผนก ให้ใช้ text เดิมไปก่อน
        
        try {
            const depts = await CandidateService.getDepartmentsWithHeadcount();
            const activeDepts = depts.filter(d => d.is_active);
            
            // เช็กว่าพนักงานคนนี้อยู่แผนกอะไร
            if (emp.department_id) {
                const matchedDept = depts.find(d => d.id === emp.department_id);
                if (matchedDept) currentDeptName = matchedDept.department_name;
            }

            activeDepts.forEach(d => {
                const isSelected = emp.department_id === d.id ? 'selected' : '';
                deptOptionsHtml += `<option value="${d.id}" ${isSelected}>${d.department_name} (${d.department_code})</option>`;
            });
        } catch (deptErr) {
            console.error("โหลดแผนกไม่สำเร็จ:", deptErr);
        }

        // ประวัติการเบิกเงิน (คงโค้ดเดิมของคุณไว้ 100%)
        let advanceListHtml = '';
        if (emp.emp_id) {
            const advanceData = await CandidateService.getAdvancePayments(emp.emp_id);
            if (!advanceData || advanceData.length === 0) {
                advanceListHtml = '<p class="text-center text-gray-500 py-6 text-sm font-bold border border-gray-200 bg-white">ยังไม่มีประวัติการขอเบิกเงินล่วงหน้า</p>';
            } else {
                advanceData.forEach(adv => {
                    const reqDate = new Date(adv.created_at).toLocaleDateString('th-TH', { hour: '2-digit', minute: '2-digit' });
                    let statusBadge = '';
                    let actionHtml = '';

                    if (adv.status === 'pending') {
                        statusBadge = '<span class="bg-yellow-100 text-yellow-800 px-2 py-1 text-[10px] font-bold border border-yellow-300">⏳ รอแอดมินโอนเงิน</span>';
                        actionHtml = `
                            <div class="mt-3 p-3 bg-gray-50 border border-gray-200 text-xs">
                                <label class="block font-bold text-red-600 mb-1">⚠️ อัปโหลดสลิปโอนเงินเพื่อยืนยัน (บังคับแนบ) *</label>
                                <div class="flex gap-2 items-center flex-wrap">
                                    <input type="file" id="slip_${adv.id}" accept="image/*" class="flex-1 border border-gray-300 p-1.5 bg-white min-w-37.5">
                                    <button onclick="approveAdvance('${emp.id}', '${adv.id}')" class="bg-green-600 text-white px-3 py-1.5 font-bold hover:bg-green-700 border-0 cursor-pointer">ยืนยันการโอน</button>
                                    <button onclick="rejectAdvance('${emp.id}', '${adv.id}')" class="bg-red-600 text-white px-3 py-1.5 font-bold hover:bg-red-700 border-0 cursor-pointer">ไม่อนุมัติ</button>
                                </div>
                            </div>
                        `;
                    } else if (adv.status === 'approved') {
                        statusBadge = '<span class="bg-green-100 text-green-700 px-2 py-1 text-[10px] font-bold border border-green-300">✅ โอนเงินแล้ว</span>';
                        actionHtml = adv.transfer_slip_url ? `<div class="mt-2 pt-2 border-t border-gray-100"><a href="${adv.transfer_slip_url}" target="_blank" class="text-blue-600 hover:text-blue-800 text-xs font-bold underline">📄 คลิกดูสลิปโอนเงิน</a></div>` : '';
                    } else {
                        statusBadge = '<span class="bg-red-100 text-red-700 px-2 py-1 text-[10px] font-bold border border-red-300">❌ ไม่อนุมัติ</span>';
                    }

                    advanceListHtml += `
                        <div class="border border-gray-300 p-4 mb-3 bg-white shadow-none">
                            <div class="flex justify-between items-start mb-1">
                                <div>
                                    <p class="font-bold text-gray-800 text-sm">🗓️ วันที่ขอเบิก: ${reqDate}</p>
                                    <p class="text-orange-600 font-bold text-lg mt-1">ยอดเงิน: ฿${adv.amount.toLocaleString()}</p>
                                </div>
                                <div>${statusBadge}</div>
                            </div>
                            ${actionHtml}
                        </div>
                    `;
                });
            }
        } else {
            advanceListHtml = '<p class="text-center text-red-500 py-4 text-sm font-bold">พนักงานคนนี้ยังไม่มีรหัสพนักงาน (emp_id)</p>';
        }

        const modalHtml = `
            <div id="empModal" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                <div class="bg-white w-full max-w-4xl rounded-none border-t-8 border-kcblue p-0 flex flex-col max-h-[90vh] overflow-hidden shadow-none">
                    
                    <div class="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50 shrink-0">
                        <div>
                            <h2 class="text-xl font-bold text-gray-900 uppercase">แฟ้มประวัติพนักงาน</h2>
                            <p class="text-sm text-kcblue font-bold mt-1">รหัสพนักงาน: ${emp.emp_id || '-'} | ${emp.full_name}</p>
                        </div>
                        <button onclick="closeModal()" class="text-gray-400 hover:text-red-600 font-bold text-3xl leading-none bg-transparent border-0 cursor-pointer">&times;</button>
                    </div>

                    <div class="flex border-b border-gray-200 bg-gray-100 shrink-0 px-6 pt-4 gap-1 overflow-x-auto">
                        <button onclick="switchEmpTab('info')" id="empTab-info" class="px-4 py-2 text-sm font-bold border border-b-0 border-gray-300 bg-kcblue text-white cursor-pointer">👤 ข้อมูลส่วนตัว</button>
                        <button onclick="switchEmpTab('attendance')" id="empTab-attendance" class="px-4 py-2 text-sm font-bold border border-b-0 border-gray-300 bg-gray-200 text-gray-600 hover:bg-white cursor-pointer transition-colors">⏱️ ประวัติเวลาทำงาน</button>
                        <button onclick="switchEmpTab('advance')" id="empTab-advance" class="px-4 py-2 text-sm font-bold border border-b-0 border-gray-300 bg-gray-200 text-gray-600 hover:bg-white cursor-pointer transition-colors">💸 เบิกเงินล่วงหน้า</button>
                        <button onclick="switchEmpTab('settings')" id="empTab-settings" class="px-4 py-2 text-sm font-bold border border-b-0 border-gray-300 bg-gray-200 text-gray-600 hover:bg-white cursor-pointer transition-colors ml-auto">⚙️ ตั้งค่าสถานะ</button>
                    </div>

                    <div class="p-6 overflow-y-auto grow bg-white">
                        
                        <div id="empView-info" class="emp-view-content space-y-4">
                            <h3 class="font-bold text-lg text-kcblue border-b border-gray-200 pb-2 mb-4">ข้อมูลเบื้องต้นและการติดต่อ</h3>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-sm">
                                <p><strong>ชื่อ-นามสกุล:</strong> ${emp.full_name}</p>
                                <p><strong>เบอร์โทรศัพท์:</strong> ${emp.phone_number}</p>
                                <p><strong>เลขบัตรประชาชน:</strong> ${emp.id_card_number || '-'}</p>
                                <p><strong>แผนก / ฝ่าย:</strong> <span class="text-kcblue font-bold">${currentDeptName}</span></p>
                                <p><strong>ตำแหน่ง:</strong> ${emp.interested_position || '-'}</p>
                                <p><strong>วันที่เริ่มงาน:</strong> ${emp.available_start_date ? new Date(emp.available_start_date).toLocaleDateString('th-TH') : '-'}</p>
                                <p><strong>โซนที่ทำงาน:</strong> ${emp.preferred_zone || '-'}</p>
                                <p><strong>ฐานเงินเดือน/ค่าจ้าง:</strong> ${emp.expected_salary || '-'} บาท</p>
                            </div>
                        </div>

                        <div id="empView-attendance" class="emp-view-content hidden space-y-4">
                            <h3 class="font-bold text-lg text-kcblue border-b border-gray-200 pb-2 mb-4">สรุปการเข้างาน และ OT</h3>
                            <div class="bg-blue-50 p-8 text-center border border-blue-200">
                                <p class="text-blue-800 font-bold mb-2">🚧 เตรียมพบกับระบบจัดการเวลาเร็วๆ นี้</p>
                            </div>
                        </div>

                        <div id="empView-advance" class="emp-view-content hidden space-y-4">
                            <div class="flex justify-between items-center border-b border-gray-200 pb-2 mb-4">
                                <h3 class="font-bold text-lg text-kcblue">ประวัติการเบิกเงินล่วงหน้า (Cash Advance)</h3>
                                <button onclick="simulateAdvanceRequest('${emp.id}', '${emp.emp_id}')" class="bg-gray-800 text-white text-xs px-3 py-1.5 font-bold hover:bg-black border-0 cursor-pointer">+ ทดสอบจำลองคำขอเบิกเงิน</button>
                            </div>
                            <div class="bg-gray-50 p-4 border border-gray-200">
                                ${advanceListHtml}
                            </div>
                        </div>

                        <div id="empView-settings" class="emp-view-content hidden space-y-6">
                            
                            <div>
                                <h3 class="font-bold text-lg text-kcblue border-b border-gray-200 pb-2 mb-4">ตั้งค่าสถานะพนักงาน</h3>
                                <div class="bg-gray-50 p-4 border border-gray-200 max-w-md">
                                    <label class="block font-bold text-gray-700 mb-2 text-sm">อัปเดตสถานะการทำงาน</label>
                                    <div class="flex gap-2">
                                        <select id="empStatusSelect" class="w-full border border-gray-300 p-2 text-sm outline-none bg-white focus:border-kcblue">
                                            <option value="hired" ${emp.status === 'hired' ? 'selected' : ''}>🟢 ทำงานอยู่ปกติ (Active)</option>
                                            <option value="suspended" ${emp.status === 'suspended' ? 'selected' : ''}>🟠 พักงาน (Suspended)</option>
                                            <option value="resigned" ${emp.status === 'resigned' ? 'selected' : ''}>🔴 ลาออก/พ้นสภาพ (Resigned)</option>
                                        </select>
                                    </div>
                                    <button onclick="updateEmployeeStatus('${emp.id}')" class="mt-3 w-full bg-gray-800 text-white px-4 py-2 text-sm font-bold hover:bg-black transition-colors cursor-pointer border-0 shadow-sm">บันทึกสถานะ</button>
                                </div>
                            </div>

                            <div>
                                <h3 class="font-bold text-lg text-blue-800 border-b border-gray-200 pb-2 mb-4">🔄 โยกย้ายแผนก / ปรับตำแหน่ง</h3>
                                <div class="bg-blue-50/50 p-4 border border-blue-200 max-w-2xl border-dashed">
                                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label class="block font-bold text-gray-700 mb-1 text-sm">เลือกแผนกใหม่ <span class="text-red-500">*</span></label>
                                            <select id="transferDeptInput" class="w-full border border-gray-400 p-2 bg-white outline-none text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600">
                                                ${deptOptionsHtml}
                                            </select>
                                        </div>
                                        <div>
                                            <label class="block font-bold text-gray-700 mb-1 text-sm">วันที่มีผลบังคับใช้ <span class="text-red-500">*</span></label>
                                            <input type="date" id="transferDateInput" class="w-full border border-gray-400 p-2 bg-white outline-none text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600">
                                        </div>
                                    </div>
                                    <div class="mt-4 flex justify-end">
                                        <button onclick="processTransfer('${emp.id}')" class="bg-blue-600 text-white px-6 py-2 text-sm font-bold border-0 cursor-pointer hover:bg-blue-700 shadow-sm transition-colors">บันทึกการโยกย้าย</button>
                                    </div>
                                </div>
                            </div>

                        </div>

                    </div>
                </div>
            </div>
        `;
        document.getElementById('modalContainer').innerHTML = modalHtml;
    } catch (err) {
        console.error(err);
    }
}

function switchEmpTab(tabName) {
    const tabs = ['info', 'attendance', 'advance', 'settings'];
    tabs.forEach(t => {
        const btn = document.getElementById(`empTab-${t}`);
        const view = document.getElementById(`empView-${t}`);
        
        if (t === tabName) {
            btn.classList.remove('bg-gray-200', 'text-gray-600');
            btn.classList.add('bg-kcblue', 'text-white');
            view.classList.remove('hidden');
        } else {
            btn.classList.add('bg-gray-200', 'text-gray-600');
            btn.classList.remove('bg-kcblue', 'text-white');
            view.classList.add('hidden');
        }
    });
}

// 🌟 เปลี่ยนชื่อจาก closeEmployeeModal เป็น closeModal เพื่อให้ตรงกับไฟล์ actions.js
function closeModal() {
    const container = document.getElementById('modalContainer');
    if (container) container.innerHTML = '';
}