async function viewDetails(id) {
    try {
        const emp = await CandidateService.getCandidateById(id);
        if (!emp) return;

        let interviewInfoHtml = '';
        if (emp.interview_date) {
            const displayDate = new Date(emp.interview_date).toLocaleDateString('th-TH');
            const typeText = emp.interview_type === 'online' ? '💻 ออนไลน์ (Zoom/Meet)' : '🏢 ออฟฟิศ (On-site)';
            interviewInfoHtml = `
                <div class="col-span-2 bg-blue-50 border border-blue-200 p-3 my-2 text-sm">
                    <div class="flex justify-between items-center mb-1">
                        <p class="font-bold text-kcblue">🗓️ รายละเอียดนัดหมายการสัมภาษณ์</p>
                        <button onclick="document.getElementById('interviewFormSection').classList.toggle('hidden')" class="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 px-2 py-1 font-bold cursor-pointer border-0">แก้ไขข้อมูลนัดหมาย</button>
                    </div>
                    <p><strong>วัน-เวลา:</strong> ${displayDate} เวลา ${emp.interview_time || '-'} น.</p>
                    <p><strong>รูปแบบ:</strong> ${typeText}</p>
                </div>
            `;
        }

        let hiredInfoHtml = '';
        if (emp.status === 'hired') {
            const startDateStr = emp.available_start_date ? new Date(emp.available_start_date).toLocaleDateString('th-TH') : 'ยังไม่ระบุ';
            hiredInfoHtml = `
                <div class="col-span-2 bg-green-50 border border-green-300 p-3 my-2 text-sm">
                    <div class="flex justify-between items-center mb-2">
                        <p class="font-bold text-green-800">✅ ข้อมูลพนักงานใหม่</p>
                        <button onclick="document.getElementById('editStartDateSection').classList.toggle('hidden')" class="text-xs bg-white border border-green-500 text-green-700 px-2 py-1 font-bold cursor-pointer hover:bg-green-100">แก้ไขวันเริ่มงาน</button>
                    </div>
                    <p><strong>รหัสพนักงาน:</strong> ${emp.emp_id || '-'}</p>
                    <p><strong>วันที่เริ่มงาน:</strong> ${startDateStr}</p>
                    
                    <div id="editStartDateSection" class="hidden mt-3 pt-3 border-t border-green-200">
                        <label class="block font-bold text-gray-700 mb-1 text-xs">เปลี่ยนวันที่เริ่มงานใหม่ <span class="text-red-500">*</span></label>
                        <div class="flex gap-2">
                            <input type="date" id="editStartDateInput" value="${emp.available_start_date || ''}" class="flex-1 border border-gray-300 p-1.5 text-sm outline-none">
                            <button onclick="updateStartDate('${emp.id}')" class="bg-green-600 text-white px-3 py-1.5 text-xs font-bold border-0 cursor-pointer hover:bg-green-700">บันทึกการเปลี่ยนแปลง</button>
                        </div>
                    </div>
                </div>
            `;
        }

        let reconsiderationNoticeHtml = '';
        if (emp.is_reconsidered && emp.status !== 'rejected' && emp.status !== 'hired') {
            reconsiderationNoticeHtml = `
                <div class="col-span-2 bg-purple-50 border border-purple-200 text-purple-700 p-3 text-xs font-bold my-1">
                    ⚠️ ประวัติ: ผู้สมัครคนนี้เคยถูกระบุว่า "ไม่ผ่านเกณฑ์" และถูกดึงกลับมาพิจารณาใหม่อีกครั้ง
                </div>
            `;
        }

        const modalHtml = `
            <div id="detailModal" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                <div class="bg-white w-full max-w-2xl rounded-none border-4 border-kcblue p-6 overflow-y-auto max-h-[90vh]">
                    <div class="flex justify-between items-center mb-4 border-b-2 border-kcblue pb-2">
                        <h2 class="text-xl font-bold text-kcblue uppercase">จัดการข้อมูลผู้สมัคร</h2>
                        <button onclick="closeModal()" class="text-2xl font-bold border-0 bg-transparent cursor-pointer">&times;</button>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 mb-4 text-sm">
                        <p><strong>ชื่อ:</strong> ${emp.full_name}</p>
                        <p><strong>เบอร์โทร:</strong> ${emp.phone_number}</p>
                        <p><strong>อีเมล:</strong> ${emp.email || '-'}</p>
                        <p><strong>ตำแหน่ง:</strong> ${emp.interested_position}</p>
                        <p><strong>เงินเดือนที่ต้องการ:</strong> ${emp.expected_salary} บาท</p>
                        <p class="col-span-2"><strong>ไฟล์แนบ:</strong> 
                            ${emp.resume_url ? `<a href="${emp.resume_url}" target="_blank" class="text-blue-600 underline ml-2">Resume</a>` : ''}
                            ${emp.profile_photo_url ? `<a href="${emp.profile_photo_url}" target="_blank" class="text-blue-600 underline ml-2">รูปถ่าย</a>` : ''}
                            ${emp.id_card_url ? `<a href="${emp.id_card_url}" target="_blank" class="text-blue-600 underline ml-2">บัตร ปชช.</a>` : ''}
                        </p>
                        ${reconsiderationNoticeHtml}
                        ${emp.status !== 'hired' && emp.status !== 'rejected' ? interviewInfoHtml : ''}
                        ${hiredInfoHtml}
                    </div>

                    <div id="interviewFormSection" class="hidden border-2 border-orange-400 bg-orange-50 p-4 mb-4">
                        <h4 class="font-bold text-orange-800 text-sm mb-3">🗓️ กำหนดการและรูปแบบการนัดสัมภาษณ์</h4>
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs mb-3">
                            <div>
                                <label class="block font-bold text-gray-700 mb-1">วันที่นัดหมาย <span class="text-red-500">*</span></label>
                                <input type="date" id="intDate" value="${emp.interview_date || ''}" class="w-full border border-gray-300 p-2 bg-white outline-none">
                            </div>
                            <div>
                                <label class="block font-bold text-gray-700 mb-1">เวลานัดหมาย <span class="text-red-500">*</span></label>
                                <input type="time" id="intTime" value="${emp.interview_time || ''}" class="w-full border border-gray-300 p-2 bg-white outline-none">
                            </div>
                            <div>
                                <label class="block font-bold text-gray-700 mb-1">รูปแบบการพบปะ <span class="text-red-500">*</span></label>
                                <select id="intType" class="w-full border border-gray-300 p-2 bg-white outline-none">
                                    <option value="online" ${emp.interview_type === 'online' ? 'selected' : ''}>💻 สัมภาษณ์ออนไลน์</option>
                                    <option value="onsite" ${emp.interview_type === 'onsite' ? 'selected' : ''}>🏢 สัมภาษณ์ที่ออฟฟิศ</option>
                                </select>
                            </div>
                        </div>
                        <div class="flex justify-end gap-2">
                            <button onclick="document.getElementById('interviewFormSection').classList.add('hidden')" class="bg-gray-500 text-white px-3 py-1 text-xs font-bold border-0 cursor-pointer">ปิดหน้าต่างนี้</button>
                            <button onclick="submitInterviewSchedule('${emp.id}')" class="bg-orange-600 text-white px-4 py-1 text-xs font-bold border-0 cursor-pointer">ยืนยันบันทึกนัดหมาย</button>
                        </div>
                    </div>

                    <div id="hireFormSection" class="hidden border-2 border-green-500 bg-green-50 p-4 mb-4">
                        <h4 class="font-bold text-green-800 text-sm mb-3">✅ ยืนยันการรับเข้าทำงาน</h4>
                        <div class="mb-3">
                            <label class="block font-bold text-gray-700 mb-1 text-xs">วันที่เริ่มทำงาน <span class="text-red-500">*</span></label>
                            <input type="date" id="startDateInput" class="w-full max-w-xs border border-gray-300 p-2 bg-white outline-none text-sm">
                        </div>
                        <div class="flex justify-end gap-2">
                            <button onclick="document.getElementById('hireFormSection').classList.add('hidden')" class="bg-gray-500 text-white px-3 py-1 text-xs font-bold border-0 cursor-pointer">ยกเลิก</button>
                            <button onclick="processHiring('${emp.id}')" class="bg-green-600 text-white px-4 py-2 text-sm font-bold border-0 cursor-pointer">ยืนยันและออกรหัสพนักงาน</button>
                        </div>
                    </div>

                    <div class="mb-6">
                        <label class="block font-bold text-kcblue mb-1 text-sm">บันทึกช่วยจำจากแอดมิน (Admin Remarks):</label>
                        <textarea id="remarksInput" class="w-full border-2 border-gray-300 p-2 text-sm rounded-none outline-none focus:border-kcblue" rows="3">${emp.admin_remarks || ''}</textarea>
                        <button onclick="updateRemarks('${emp.id}')" class="mt-2 text-xs bg-gray-800 text-white px-3 py-1 font-bold rounded-none border-0 cursor-pointer">บันทึกโน้ต</button>
                    </div>

                    <div class="flex flex-wrap gap-2 justify-end border-t-2 border-gray-100 pt-4">
                        ${emp.status === 'rejected' ? `<button onclick="restoreCandidate('${emp.id}')" class="bg-gray-600 text-white px-4 py-2 font-bold rounded-none border-0 cursor-pointer">🔄 ดึงกลับมาพิจารณาใหม่</button>` : ''}
                        
                        ${(!emp.interview_date && emp.status !== 'hired' && emp.status !== 'rejected') ? `<button onclick="document.getElementById('interviewFormSection').classList.remove('hidden')" class="bg-orange-500 text-white px-4 py-2 font-bold rounded-none border-0 cursor-pointer">กำหนดวันนัดสัมภาษณ์</button>` : ''}
                        
                        ${emp.status === 'interview' || emp.status === 'applied' ? `<button onclick="document.getElementById('hireFormSection').classList.remove('hidden')" class="bg-green-600 text-white px-4 py-2 font-bold rounded-none border-0 cursor-pointer">รับเข้าทำงาน</button>` : ''}
                        
                        ${emp.status !== 'rejected' ? `<button onclick="updateStatus('${emp.id}', 'rejected')" class="bg-red-600 text-white px-4 py-2 font-bold rounded-none border-0 cursor-pointer">ไม่ผ่านเกณฑ์</button>` : ''}
                    </div>
                </div>
            </div>
        `;
        document.getElementById('modalContainer').innerHTML = modalHtml;
    } catch (err) {
        console.error(err);
    }
}

function closeModal() { 
    const container = document.getElementById('modalContainer');
    if (container) container.innerHTML = ''; 
}