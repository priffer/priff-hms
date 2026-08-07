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

        // 🌟 1.5 ผูกไซต์ลูกค้าประจำ (เพื่อกำหนดว่าพนักงานคนนี้เห็นปฏิทินวันหยุดของไซต์ไหนในหน้า ESS)
        let siteAssignmentHtml = '<p class="text-sm text-slate-500">กำลังโหลด...</p>';
        try {
            const [clientSites, userProfile] = await Promise.all([
                CandidateService.getClientSites(),
                emp.emp_id ? CandidateService.getUserProfileByEmployeeId(emp.id) : Promise.resolve(null)
            ]);

            if (!userProfile) {
                siteAssignmentHtml = `
                    <p class="text-sm text-slate-500 bg-kcsoft border border-[#e6edf7] p-3">
                        ℹ️ พนักงานคนนี้ยังไม่มีบัญชี ESS (user_profiles) จึงยังไม่สามารถผูกไซต์งานได้ในตอนนี้
                    </p>`;
            } else if (userProfile.role === 'supervisor') {
                const assignedIds = await CandidateService.getSupervisorAssignedClientIds(userProfile.id);
                const checkboxesHtml = (clientSites || []).map(site => `
                    <label class="flex items-center gap-2 text-sm border border-[#e6edf7] px-3 py-2 bg-white hover:bg-kcsoft cursor-pointer">
                        <input type="checkbox" class="supervisorSiteCheckbox" value="${site.id}" ${assignedIds.includes(site.id) ? 'checked' : ''}>
                        ${site.client_name}
                    </label>
                `).join('') || '<p class="text-sm text-slate-500">ยังไม่มีไซต์ลูกค้าในระบบ</p>';

                siteAssignmentHtml = `
                    <p class="text-xs text-slate-500 mb-2">ตำแหน่งนี้คือ <strong>Supervisor</strong> — เลือกได้หลายไซต์ที่ดูแล พนักงานจะเห็นปฏิทินวันหยุดของทุกไซต์ที่เลือกไว้</p>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">${checkboxesHtml}</div>
                    <button onclick="saveSupervisorSites('${userProfile.id}')" class="bg-emerald-600 text-white px-4 py-2 text-sm font-bold hover:bg-emerald-700 rounded-xl border-0 cursor-pointer">บันทึกไซต์ที่ดูแล</button>
                `;
            } else {
                const siteOptionsHtml = (clientSites || []).map(site =>
                    `<option value="${site.id}" ${userProfile.primary_client_id === site.id ? 'selected' : ''}>${site.client_name}</option>`
                ).join('');

                siteAssignmentHtml = `
                    <p class="text-xs text-slate-500 mb-2">พนักงานปฏิบัติการที่ประจำไซต์ลูกค้า จะเห็นปฏิทินวันหยุดของไซต์นี้แทนปฏิทินบริษัท (ถ้าไซต์นี้มีการตั้งค่าปฏิทินของตัวเอง) — ถ้าเป็นพนักงานออฟฟิศ ให้เลือก "ไม่ประจำไซต์ลูกค้า (พนักงานออฟฟิศ)"</p>
                    <div class="flex gap-2 max-w-md">
                        <select id="siteAssignSelect" class="w-full border rounded-xl border-[#e6edf7] p-2 text-sm outline-none bg-white focus:border-kcblue">
                            <option value="">-- ไม่ประจำไซต์ลูกค้า (พนักงานออฟฟิศ) --</option>
                            ${siteOptionsHtml}
                        </select>
                        <button onclick="saveSiteAssignment('${userProfile.id}')" class="bg-emerald-600 text-white px-4 py-2 text-sm font-bold hover:bg-emerald-700 rounded-xl border-0 cursor-pointer shrink-0">บันทึก</button>
                    </div>
                `;
            }
        } catch (siteErr) {
            console.error('โหลดข้อมูลผูกไซต์ลูกค้าไม่สำเร็จ:', siteErr);
            siteAssignmentHtml = '<p class="text-sm text-red-500">โหลดข้อมูลไซต์ลูกค้าไม่สำเร็จ</p>';
        }

        // 🌟 1.6 กะการทำงาน (สำหรับตรวจจับมาสาย/ครึ่งวัน/ทำงานเกินกะในหน้า ESS และเตรียมพร้อมสำหรับฟีเจอร์ขอโอที)
        let shiftAssignmentHtml = '<p class="text-sm text-slate-500">กำลังโหลด...</p>';
        try {
            const currentShift = await CandidateService.getCurrentShiftAssignment(emp.id);
            const s = currentShift || {};
            shiftAssignmentHtml = `
                <p class="text-xs text-slate-500 mb-2">กำหนดเวลากะปกติของพนักงานคนนี้ ใช้คำนวณมาสาย/ออกก่อน/ทำงานเกินกะ ในหน้า ESS ${currentShift ? `<br><span class="text-emerald-600 font-bold">กะปัจจุบัน: ${s.shift_name ? s.shift_name + ' ' : ''}${s.shift_start}-${s.shift_end} (${s.standard_hours} ชม./วัน)${s.shift_end < s.shift_start ? ' 🌙 กะข้ามคืน' : ''}</span>` : '<br><span class="text-amber-600 font-bold">ยังไม่ได้กำหนดกะ</span>'}</p>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2 max-w-2xl">
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1">ชื่อกะ (ถ้ามี)</label>
                        <input type="text" id="shiftNameInput" value="${s.shift_name || ''}" placeholder="เช่น กะเช้า" class="w-full border rounded-xl border-[#e6edf7] p-2 text-sm outline-none bg-white focus:border-kcblue">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1">เวลาเข้า *</label>
                        <input type="time" id="shiftStartInput" value="${s.shift_start ? s.shift_start.slice(0,5) : '08:00'}" class="w-full border rounded-xl border-[#e6edf7] p-2 text-sm outline-none bg-white focus:border-kcblue">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1">เวลาออก *</label>
                        <input type="time" id="shiftEndInput" value="${s.shift_end ? s.shift_end.slice(0,5) : '17:00'}" class="w-full border rounded-xl border-[#e6edf7] p-2 text-sm outline-none bg-white focus:border-kcblue">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1">ชม.ปกติ/วัน *</label>
                        <input type="number" id="shiftStandardHoursInput" value="${s.standard_hours || 8}" min="1" max="24" step="0.5" class="w-full border rounded-xl border-[#e6edf7] p-2 text-sm outline-none bg-white focus:border-kcblue">
                    </div>
                </div>
                <button onclick="saveEmployeeShift('${emp.id}')" class="mt-3 bg-emerald-600 text-white px-4 py-2 text-sm font-bold hover:bg-emerald-700 rounded-xl border-0 cursor-pointer">บันทึกกะการทำงาน</button>
            `;
        } catch (shiftErr) {
            console.error('โหลดข้อมูลกะการทำงานไม่สำเร็จ:', shiftErr);
            shiftAssignmentHtml = '<p class="text-sm text-red-500">โหลดข้อมูลกะการทำงานไม่สำเร็จ</p>';
        }

        // ประวัติการเบิกเงิน (คงโค้ดเดิมของคุณไว้ 100%)
        let advanceListHtml = '';
        // ยอดสะสมประมาณการของพนักงานคนนี้ - แสดงให้ admin ดูประกอบการตัดสินใจอนุมัติ
        // (ตัวเลขประมาณการเท่านั้น ไม่ใช่ยอดจริงจาก Payroll Engine - database/23_advance_payment_admin_tools.sql)
        let advanceEstimateHtml = '';
        if (emp.emp_id) {
            try {
                const est = await CandidateService.getAdvancePaymentEstimateForEmployee(emp.emp_id);
                if (est && !est.error) {
                    if (est.has_salary_config) {
                        advanceEstimateHtml = `
                            <div class="rounded-xl border border-[#e6edf7] bg-[#f7faff] p-4 mb-4">
                                <div class="flex items-center justify-between mb-2">
                                    <h4 class="text-sm font-bold text-kcdark">📊 ยอดสะสมประมาณการ (งวดนี้)</h4>
                                    <span class="inline-block bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 text-[10px] font-bold">⚠️ ประมาณการ ไม่ใช่ยอดจริง</span>
                                </div>
                                <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                    <div class="bg-white border border-[#e6edf7] rounded-lg p-2"><p class="text-slate-500">วันทำงาน</p><p class="font-extrabold text-kcdark">${est.worked_days} วัน</p></div>
                                    <div class="bg-white border border-[#e6edf7] rounded-lg p-2"><p class="text-slate-500">มาสาย</p><p class="font-extrabold text-kcdark">${est.late_count} ครั้ง</p></div>
                                    <div class="bg-white border border-[#e6edf7] rounded-lg p-2"><p class="text-slate-500">วันลา</p><p class="font-extrabold text-kcdark">${est.leave_days} วัน</p></div>
                                    <div class="bg-white border border-[#e6edf7] rounded-lg p-2"><p class="text-slate-500">OT (1.5/2/3x)</p><p class="font-extrabold text-kcdark">${est.ot15_hours}/${est.ot2_hours}/${est.ot3_hours} ชม.</p></div>
                                    <div class="col-span-2 bg-white border border-[#e6edf7] rounded-lg p-2"><p class="text-slate-500">ค่าแรงสะสม (ประมาณการ)</p><p class="font-extrabold text-kcdark">฿${Number(est.estimated_earned_total).toLocaleString()}</p></div>
                                    <div class="col-span-2 bg-emerald-50 border border-emerald-200 rounded-lg p-2"><p class="text-emerald-700">ยอดเบิกได้สูงสุดที่แนะนำ (30%)</p><p class="font-extrabold text-emerald-700">฿${Number(est.available_to_request).toLocaleString()}</p></div>
                                </div>
                            </div>`;
                    } else {
                        advanceEstimateHtml = `<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-4 text-xs text-amber-800">ℹ️ ยังไม่ได้ตั้งค่าเงินเดือน/ค่าแรงของพนักงานคนนี้ - ไปที่แท็บ "⚙️ ตั้งค่าสถานะ" เพื่อกรอกข้อมูล จะช่วยให้ระบบประมาณการยอดเบิกได้ให้อัตโนมัติ</div>`;
                    }
                }
            } catch (estErr) {
                console.error('โหลดยอดประมาณการไม่สำเร็จ:', estErr);
            }
        }
        if (emp.emp_id) {
            const advanceData = await CandidateService.getAdvancePayments(emp.emp_id);
            if (!advanceData || advanceData.length === 0) {
                advanceListHtml = '<p class="text-center text-slate-500 py-6 text-sm font-bold border border-[#e6edf7] bg-white">ยังไม่มีประวัติการขอเบิกเงินล่วงหน้า</p>';
            } else {
                advanceData.forEach(adv => {
                    const reqDate = new Date(adv.created_at).toLocaleDateString('th-TH', { hour: '2-digit', minute: '2-digit' });
                    let statusBadge = '';
                    let actionHtml = '';

                    if (adv.status === 'pending') {
                        statusBadge = '<span class="bg-yellow-100 text-yellow-800 px-2 py-1 text-[10px] font-bold border border-yellow-300">⏳ รอแอดมินโอนเงิน</span>';
                        actionHtml = `
                            <div class="mt-3 p-3 bg-kcsoft border border-[#e6edf7] text-xs">
                                <label class="block font-bold text-red-600 mb-1">⚠️ อัปโหลดสลิปโอนเงินเพื่อยืนยัน (บังคับแนบ) *</label>
                                <div class="flex gap-2 items-center flex-wrap">
                                    <input type="file" id="slip_${adv.id}" accept="image/*" class="flex-1 border rounded-xl border-[#e6edf7] p-1.5 bg-white min-w-37.5">
                                    <button onclick="approveAdvance('${emp.id}', '${adv.id}')" class="bg-green-600 text-white px-3 py-1.5 font-bold hover:bg-green-700 rounded-xl border-0 cursor-pointer">ยืนยันการโอน</button>
                                </div>
                                <label class="block font-bold text-slate-600 mt-2 mb-1">หรือไม่อนุมัติ (ระบุเหตุผล ไม่บังคับ)</label>
                                <div class="flex gap-2 items-center flex-wrap">
                                    <input type="text" id="rejectReason_${adv.id}" placeholder="เหตุผลที่ไม่อนุมัติ (ถ้ามี)" class="flex-1 border rounded-xl border-[#e6edf7] p-1.5 bg-white min-w-37.5">
                                    <button onclick="rejectAdvance('${emp.id}', '${adv.id}')" class="bg-red-600 text-white px-3 py-1.5 font-bold hover:bg-red-700 rounded-xl border-0 cursor-pointer">ไม่อนุมัติ</button>
                                </div>
                            </div>
                        `;
                    } else if (adv.status === 'approved') {
                        statusBadge = '<span class="bg-green-100 text-green-700 px-2 py-1 text-[10px] font-bold border border-green-300">✅ โอนเงินแล้ว</span>';
                        actionHtml = adv.transfer_slip_url ? `<div class="mt-2 pt-2 border-t border-gray-100"><a href="${adv.transfer_slip_url}" target="_blank" class="text-blue-600 hover:text-blue-800 text-xs font-bold underline">📄 คลิกดูสลิปโอนเงิน</a></div>` : '';
                    } else {
                        statusBadge = '<span class="bg-red-100 text-red-700 px-2 py-1 text-[10px] font-bold border border-red-300">❌ ไม่อนุมัติ</span>';
                    }

                    const capBadge = adv.exceeds_estimated_cap
                        ? '<span class="ml-1 inline-block bg-orange-100 text-orange-700 px-2 py-1 text-[10px] font-bold border border-orange-300">🔺 เกินยอดแนะนำ</span>'
                        : '';

                    advanceListHtml += `
                        <div class="border rounded-xl border-[#e6edf7] p-4 mb-3 bg-white shadow-[0_16px_40px_rgba(15,43,115,0.15)]">
                            <div class="flex justify-between items-start mb-1">
                                <div>
                                    <p class="font-bold text-kcdark text-sm">🗓️ วันที่ขอเบิก: ${reqDate}</p>
                                    <p class="text-orange-600 font-bold text-lg mt-1">ยอดเงิน: ฿${adv.amount.toLocaleString()}</p>
                                </div>
                                <div>${statusBadge}${capBadge}</div>
                            </div>
                            ${adv.employee_remark ? `<p class="text-xs text-slate-600 mt-1">📝 หมายเหตุจากพนักงาน: ${adv.employee_remark}</p>` : ''}
                            ${actionHtml}
                        </div>
                    `;
                });
            }
        } else {
            advanceListHtml = '<p class="text-center text-red-500 py-4 text-sm font-bold">พนักงานคนนี้ยังไม่มีรหัสพนักงาน (emp_id)</p>';
        }

        const modalHtml = `
            <div id="empModal" class="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4">
                <div class="bg-white w-full max-w-4xl rounded-[2rem] p-0 flex flex-col max-h-[90vh] overflow-hidden shadow-[0_16px_40px_rgba(15,43,115,0.15)]">
                    
                    <div class="p-6 border-b border-[#e6edf7] flex justify-between items-center bg-kcsoft shrink-0">
                        <div>
                            <h2 class="text-xl font-bold text-kcdark uppercase">แฟ้มประวัติพนักงาน</h2>
                            <p class="text-sm text-kcblue font-bold mt-1">รหัสพนักงาน: ${emp.emp_id || '-'} | ${emp.full_name}</p>
                        </div>
                        <button onclick="closeModal()" class="text-slate-400 hover:text-red-600 font-bold text-3xl leading-none bg-transparent rounded-xl border-0 cursor-pointer">&times;</button>
                    </div>

                    <div class="flex border-b border-[#e6edf7] bg-kcsoft shrink-0 px-6 pt-4 gap-1 overflow-x-auto">
                        <button onclick="switchEmpTab('info')" id="empTab-info" class="px-4 py-2 text-sm font-bold border border-b-0 rounded-xl border-[#e6edf7] bg-kcblue text-white cursor-pointer">👤 ข้อมูลส่วนตัว</button>
                        <button onclick="switchEmpTab('attendance')" id="empTab-attendance" class="px-4 py-2 text-sm font-bold border border-b-0 rounded-xl border-[#e6edf7] bg-kclight text-slate-600 hover:bg-white cursor-pointer transition-colors">⏱️ ประวัติเวลาทำงาน</button>
                        <button onclick="switchEmpTab('advance')" id="empTab-advance" class="px-4 py-2 text-sm font-bold border border-b-0 rounded-xl border-[#e6edf7] bg-kclight text-slate-600 hover:bg-white cursor-pointer transition-colors">💸 เบิกเงินล่วงหน้า</button>
                        <button onclick="switchEmpTab('settings')" id="empTab-settings" class="px-4 py-2 text-sm font-bold border border-b-0 rounded-xl border-[#e6edf7] bg-kclight text-slate-600 hover:bg-white cursor-pointer transition-colors ml-auto">⚙️ ตั้งค่าสถานะ</button>
                    </div>

                    <div class="p-6 overflow-y-auto grow bg-white">
                        
                        <div id="empView-info" class="emp-view-content space-y-4">
                            <h3 class="font-bold text-lg text-kcblue border-b border-[#e6edf7] pb-2 mb-4">ข้อมูลเบื้องต้นและการติดต่อ</h3>
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
                            <h3 class="font-bold text-lg text-kcblue border-b border-[#e6edf7] pb-2 mb-4">สรุปการเข้างาน และ OT</h3>
                            <div class="bg-blue-50 p-8 text-center border border-blue-200">
                                <p class="text-blue-800 font-bold mb-2">🚧 เตรียมพบกับระบบจัดการเวลาเร็วๆ นี้</p>
                            </div>
                        </div>

                        <div id="empView-advance" class="emp-view-content hidden space-y-4">
                            <div class="flex justify-between items-center border-b border-[#e6edf7] pb-2 mb-4">
                                <h3 class="font-bold text-lg text-kcblue">ประวัติการเบิกเงินล่วงหน้า (Cash Advance)</h3>
                                <button onclick="simulateAdvanceRequest('${emp.id}', '${emp.emp_id}')" class="bg-kcdark text-white text-xs px-3 py-1.5 font-bold hover:bg-kcblue rounded-xl border-0 cursor-pointer">+ ทดสอบจำลองคำขอเบิกเงิน</button>
                            </div>
                            ${advanceEstimateHtml}
                            <div class="bg-kcsoft p-4 border border-[#e6edf7]">
                                ${advanceListHtml}
                            </div>
                        </div>

                        <div id="empView-settings" class="emp-view-content hidden space-y-6">
                            
                            <div>
                                <h3 class="font-bold text-lg text-kcblue border-b border-[#e6edf7] pb-2 mb-4">ตั้งค่าสถานะพนักงาน</h3>
                                <div class="bg-kcsoft p-4 border border-[#e6edf7] max-w-md">
                                    <label class="block font-bold text-slate-700 mb-2 text-sm">อัปเดตสถานะการทำงาน</label>
                                    <div class="flex gap-2">
                                        <select id="empStatusSelect" class="w-full border rounded-xl border-[#e6edf7] p-2 text-sm outline-none bg-white focus:border-kcblue">
                                            <option value="hired" ${emp.status === 'hired' ? 'selected' : ''}>🟢 ทำงานอยู่ปกติ (Active)</option>
                                            <option value="suspended" ${emp.status === 'suspended' ? 'selected' : ''}>🟠 พักงาน (Suspended)</option>
                                            <option value="resigned" ${emp.status === 'resigned' ? 'selected' : ''}>🔴 ลาออก/พ้นสภาพ (Resigned)</option>
                                        </select>
                                    </div>
                                    <button onclick="updateEmployeeStatus('${emp.id}')" class="mt-3 w-full bg-kcdark text-white px-4 py-2 text-sm font-bold hover:bg-kcblue transition-colors cursor-pointer border-0 shadow-sm">บันทึกสถานะ</button>
                                </div>
                            </div>

                            <div>
                                <h3 class="font-bold text-lg text-blue-800 border-b border-[#e6edf7] pb-2 mb-4">🔄 โยกย้ายแผนก / ปรับตำแหน่ง</h3>
                                <div class="bg-blue-50/50 p-4 border border-blue-200 max-w-2xl border-dashed">
                                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label class="block font-bold text-slate-700 mb-1 text-sm">เลือกแผนกใหม่ <span class="text-red-500">*</span></label>
                                            <select id="transferDeptInput" class="w-full border rounded-xl border-[#e6edf7] p-2 bg-white outline-none text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600">
                                                ${deptOptionsHtml}
                                            </select>
                                        </div>
                                        <div>
                                            <label class="block font-bold text-slate-700 mb-1 text-sm">วันที่มีผลบังคับใช้ <span class="text-red-500">*</span></label>
                                            <input type="date" id="transferDateInput" class="w-full border rounded-xl border-[#e6edf7] p-2 bg-white outline-none text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600">
                                        </div>
                                    </div>
                                    <div class="mt-4 flex justify-end">
                                        <button onclick="processTransfer('${emp.id}')" class="bg-blue-600 text-white px-6 py-2 text-sm font-bold rounded-xl border-0 cursor-pointer hover:bg-blue-700 shadow-sm transition-colors">บันทึกการโยกย้าย</button>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h3 class="font-bold text-lg text-emerald-800 border-b border-[#e6edf7] pb-2 mb-4">🏢 ผูกไซต์ลูกค้าประจำ (สำหรับปฏิทินวันหยุด ESS)</h3>
                                <div class="bg-emerald-50/50 p-4 border border-emerald-200 max-w-2xl border-dashed">
                                    ${siteAssignmentHtml}
                                </div>
                            </div>

                            <div>
                                <h3 class="font-bold text-lg text-sky-800 border-b border-[#e6edf7] pb-2 mb-4">⏰ กะการทำงาน (สำหรับตรวจจับมาสาย/ทำงานเกินกะ)</h3>
                                <div class="bg-sky-50/50 p-4 border border-sky-200 max-w-2xl border-dashed">
                                    ${shiftAssignmentHtml}
                                </div>
                            </div>

                            <div>
                                <h3 class="font-bold text-lg text-orange-800 border-b border-[#e6edf7] pb-2 mb-4">💰 ตั้งค่าเงินเดือน/ค่าจ้าง (ใช้คำนวณยอดประมาณการเบิกล่วงหน้าให้พนักงาน)</h3>
                                <div class="bg-orange-50/50 p-4 border border-orange-200 max-w-2xl border-dashed">
                                    <p class="text-xs text-slate-500 mb-3">ใช้เป็นฐานคำนวณ "ยอดสะสมประมาณการ" ในหน้าขอเบิกเงินล่วงหน้าของพนักงานเท่านั้น (ไม่ใช่ค่าที่ Payroll Engine จริงใช้คำนวณสลิปเงินเดือน)</p>
                                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div>
                                            <label class="block text-xs font-bold text-slate-600 mb-1">ประเภทค่าจ้าง *</label>
                                            <select id="salaryTypeSelect" class="w-full border rounded-xl border-[#e6edf7] p-2 text-sm outline-none bg-white focus:border-kcblue">
                                                <option value="">-- เลือกประเภท --</option>
                                                <option value="monthly" ${emp.salary_type === 'monthly' ? 'selected' : ''}>รายเดือน</option>
                                                <option value="daily" ${emp.salary_type === 'daily' ? 'selected' : ''}>รายวัน</option>
                                                <option value="hourly" ${emp.salary_type === 'hourly' ? 'selected' : ''}>รายชั่วโมง</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label class="block text-xs font-bold text-slate-600 mb-1">เงินเดือน (บาท/เดือน)</label>
                                            <input type="number" id="monthlySalaryInput" value="${emp.monthly_salary ?? ''}" min="0" step="0.01" class="w-full border rounded-xl border-[#e6edf7] p-2 text-sm outline-none bg-white focus:border-kcblue">
                                        </div>
                                        <div>
                                            <label class="block text-xs font-bold text-slate-600 mb-1">ค่าจ้างรายวัน (บาท/วัน)</label>
                                            <input type="number" id="dailyRateInput" value="${emp.daily_rate ?? ''}" min="0" step="0.01" class="w-full border rounded-xl border-[#e6edf7] p-2 text-sm outline-none bg-white focus:border-kcblue">
                                        </div>
                                        <div>
                                            <label class="block text-xs font-bold text-slate-600 mb-1">ค่าจ้างรายชั่วโมง (บาท/ชม.)</label>
                                            <input type="number" id="hourlyRateInput" value="${emp.hourly_rate ?? ''}" min="0" step="0.01" class="w-full border rounded-xl border-[#e6edf7] p-2 text-sm outline-none bg-white focus:border-kcblue">
                                        </div>
                                        <div>
                                            <label class="block text-xs font-bold text-slate-600 mb-1">ชม.มาตรฐาน/เดือน (สำหรับรายเดือน)</label>
                                            <input type="number" id="stdMonthlyHoursInput" value="${emp.standard_monthly_hours ?? ''}" min="0" step="0.01" placeholder="เช่น 173.33" class="w-full border rounded-xl border-[#e6edf7] p-2 text-sm outline-none bg-white focus:border-kcblue">
                                        </div>
                                        <div>
                                            <label class="block text-xs font-bold text-slate-600 mb-1">ชม.มาตรฐาน/วัน (สำหรับรายวัน)</label>
                                            <input type="number" id="stdWorkingHoursInput" value="${emp.standard_working_hours ?? ''}" min="0" step="0.5" placeholder="เช่น 8" class="w-full border rounded-xl border-[#e6edf7] p-2 text-sm outline-none bg-white focus:border-kcblue">
                                        </div>
                                    </div>
                                    <button onclick="saveSalaryConfig('${emp.id}')" class="mt-3 bg-orange-600 text-white px-4 py-2 text-sm font-bold hover:bg-orange-700 rounded-xl border-0 cursor-pointer">บันทึกค่าจ้าง/เงินเดือน</button>
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
            btn.classList.remove('bg-kclight', 'text-slate-600');
            btn.classList.add('bg-kcblue', 'text-white');
            view.classList.remove('hidden');
        } else {
            btn.classList.add('bg-kclight', 'text-slate-600');
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